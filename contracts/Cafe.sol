// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import "./RentToken.sol";
import "./interfaces/ICafe.sol";
import "./interfaces/IRewarder.sol";

contract Cafe is Context, AccessControlEnumerable, ICafe {
	using SafeERC20 for IERC20;

	bytes32 public constant USER_UPDATER_ROLE = keccak256("USER_UPDATER_ROLE");
	bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
	bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

	struct UserInfo {
		uint256 balance;
		uint256 total;
		uint256 debt;
	}

	struct PoolInfo {
		IERC20 token;
		uint256 allocation;
		uint256 lastRewardTimestamp;
		uint256 accRentPerShare;
		uint256 balance;
		uint16 withdrawFee;
	}

	RentToken public rent;
	IRewarder public rewarder;

	// Constants
	uint256 public constant BONUS_MULTIPLIER = 10;
	uint256 public constant ACC_RENT_PRECISION = 1e12;
	uint32 public constant WITHDRAW_FEE_PRECISION = 1e4;
	uint32 public constant MAX_WITHDRAW_FEE = 500;

	// Emission config
	uint256 public startTimestamp;
	uint256 public totalAllocation = 0;
	uint256 public bonusEndTimestamp;
	uint256 public rentPerSecond;
	address public feeAddress;

	// Pools and users
	PoolInfo[] public pools;
	mapping(uint256 => mapping(address => UserInfo)) public users;
	mapping(address => bool) public addedTokens;

	// Developer address
	address public devAddress;

	// Events
	event Deposit(address indexed user, uint256 indexed poolId, uint256 amount);
	event Withdraw(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount,
		uint256 fee
	);
	event EmergencyWithdraw(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount,
		uint256 fee
	);
	event Harvest(address indexed user, uint256 indexed poolId, uint256 amount);
	event AddPool(
		uint256 indexed poolId,
		IERC20 indexed token,
		uint256 allocation,
		uint16 withdrawFee
	);
	event PatchPool(
		uint256 indexed poolId,
		uint256 allocation,
		uint16 withdrawFee
	);
	event UpdatePool(
		uint256 indexed poolId,
		uint256 lastRewardTimestamp,
		uint256 total,
		uint256 balance,
		uint256 accRentPerShare
	);
	event UpdateUserTotal(
		address indexed user,
		uint256 indexed poolId,
		uint256 total,
		uint256 debt
	);
	event UpdatePoolTotal(uint256 indexed poolId, uint256 total);
	event SetDevAddress(address devAddress);
	event SetFeeAddress(address feeAddress);
	event SetRentPerSecond(uint256 rentPerSecond);

	constructor(
		RentToken _rent,
		IRewarder _rewarder,
		address _devAddress,
		address _feeAddress,
		uint256 _rentPerSecond,
		uint256 _startTimestamp,
		uint256 _bonusEndTimestamp
	) {
		rent = _rent;
		rewarder = _rewarder;
		devAddress = _devAddress;
		rentPerSecond = _rentPerSecond;
		bonusEndTimestamp = _bonusEndTimestamp;
		startTimestamp = _startTimestamp;
		feeAddress = _feeAddress;

		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
		_setupRole(USER_UPDATER_ROLE, _msgSender());
		_setupRole(POOL_MANAGER_ROLE, _msgSender());
		_setupRole(MANAGER_ROLE, _msgSender());
	}

	function poolLength() external view returns (uint256) {
		return pools.length;
	}

	function addPool(
		uint256 allocation,
		IERC20 token,
		uint16 withdrawFee
	) public onlyRole(POOL_MANAGER_ROLE) {
		require(withdrawFee <= MAX_WITHDRAW_FEE, "Cafe: withdraw fee too high");
		require(addedTokens[address(token)] == false, "Cafe: token already added");
		massUpdatePools();

		uint256 lastRewardTimestamp = block.timestamp > startTimestamp
			? block.timestamp
			: startTimestamp;

		totalAllocation += allocation;
		addedTokens[address(token)] = true;
		pools.push(
			PoolInfo({
				token: token,
				allocation: allocation,
				lastRewardTimestamp: lastRewardTimestamp,
				withdrawFee: withdrawFee,
				accRentPerShare: 0,
				balance: 0
			})
		);

		emit AddPool(pools.length - 1, token, allocation, withdrawFee);
	}

	function patchPool(
		uint256 poolId,
		uint256 allocation,
		uint16 withdrawFee
	) public onlyRole(POOL_MANAGER_ROLE) {
		require(withdrawFee <= MAX_WITHDRAW_FEE, "Cafe: withdraw fee too high");
		massUpdatePools();
		totalAllocation += allocation;
		totalAllocation -= pools[poolId].allocation;
		pools[poolId].allocation = allocation;
		pools[poolId].withdrawFee = withdrawFee;
		emit PatchPool(poolId, allocation, withdrawFee);
	}

	function getMultiplier(uint256 from, uint256 to)
		public
		view
		returns (uint256)
	{
		if (to <= bonusEndTimestamp) {
			return (to - from) * BONUS_MULTIPLIER;
		} else if (from >= bonusEndTimestamp) {
			return to - from;
		}

		return
			((bonusEndTimestamp - from) * BONUS_MULTIPLIER) + to - bonusEndTimestamp;
	}

	function pendingRent(uint256 poolId, address userId)
		external
		view
		returns (uint256)
	{
		PoolInfo storage pool = pools[poolId];
		UserInfo storage user = users[poolId][userId];

		uint256 accRentPerShare = pool.accRentPerShare;

		if (block.timestamp > pool.lastRewardTimestamp && pool.balance != 0) {
			uint256 multiplier = getMultiplier(
				pool.lastRewardTimestamp,
				block.timestamp
			);
			uint256 reward = (multiplier * rentPerSecond * pool.allocation) /
				totalAllocation;

			accRentPerShare += (reward * ACC_RENT_PRECISION) / pool.balance;
		}

		return ((user.total * accRentPerShare) / ACC_RENT_PRECISION) - user.debt;
	}

	function massUpdatePools() private {
		uint256 length = pools.length;
		for (uint256 poolId = 0; poolId < length; poolId++) {
			updatePool(poolId);
		}
	}

	function updatePool(uint256 poolId) public {
		PoolInfo storage pool = pools[poolId];
		if (block.timestamp <= pool.lastRewardTimestamp) {
			return;
		}

		if (pool.balance > 0) {
			uint256 multiplier = getMultiplier(
				pool.lastRewardTimestamp,
				block.timestamp
			);
			uint256 reward = (multiplier * rentPerSecond * pool.allocation) /
				totalAllocation;

			rent.mint(devAddress, reward / 10);
			rent.mint(address(this), reward);

			pool.accRentPerShare += (reward * ACC_RENT_PRECISION) / pool.balance;
		}

		pool.lastRewardTimestamp = block.timestamp;

		emit UpdatePool(
			poolId,
			pool.lastRewardTimestamp,
			pool.balance,
			pool.token.balanceOf(address(this)),
			pool.accRentPerShare
		);
	}

	function harvest(address from, uint256 poolId) private {
		updatePool(poolId);

		PoolInfo storage pool = pools[poolId];
		UserInfo storage user = users[poolId][from];
		uint256 pending = 0;

		if (user.total > 0) {
			pending =
				((user.total * pool.accRentPerShare) / ACC_RENT_PRECISION) -
				user.debt;
			if (pending > 0) {
				rent.transfer(from, pending);
			}
		}

		emit Harvest(from, poolId, pending);
	}

	function harvest(uint256 poolId) public {
		harvest(_msgSender(), poolId);
		updateDebt(_msgSender(), poolId);
	}

	function harvestAll() public {
		for (uint256 i = 0; i < pools.length; i++) {
			harvest(i);
		}
	}

	function updateDebt(address addr, uint256 poolId) internal {
		PoolInfo storage pool = pools[poolId];
		UserInfo storage user = users[poolId][addr];

		user.debt = (user.total * pool.accRentPerShare) / ACC_RENT_PRECISION;

		emit UpdateUserTotal(addr, poolId, user.total, user.debt);
	}

	function updateUserTotal(
		address addr,
		uint256 poolId,
		uint256 total
	) private {
		PoolInfo storage pool = pools[poolId];
		UserInfo storage user = users[poolId][addr];

		// Update the pool
		pool.balance += total;
		pool.balance -= user.total;

		// Update the user
		user.total = total;
		updateDebt(addr, poolId);

		// Emit update events
		emit UpdateUserTotal(addr, poolId, user.total, user.debt);
		emit UpdatePoolTotal(poolId, pool.balance);
	}

	function updateUserBalance(
		uint256 poolId,
		address addr,
		uint256 balance
	) private {
		UserInfo storage user = users[poolId][addr];

		// Update the user
		user.balance = balance;
		updateUserTotal(
			addr,
			poolId,
			rewarder.updateUserBalance(poolId, _msgSender(), user.balance)
		);
	}

	function deposit(uint256 poolId, uint256 amount) public {
		PoolInfo storage pool = pools[poolId];
		UserInfo storage user = users[poolId][_msgSender()];

		// Automatic harvest
		harvest(_msgSender(), poolId);
		updateUserBalance(poolId, _msgSender(), user.balance + amount);
		pool.token.safeTransferFrom(address(_msgSender()), address(this), amount);

		emit Deposit(_msgSender(), poolId, amount);
	}

	function doWithdraw(PoolInfo storage pool, uint256 amount)
		private
		returns (uint256 received, uint256 fee)
	{
		if (pool.withdrawFee == 0) {
			pool.token.safeTransfer(address(_msgSender()), amount);
			return (amount, 0);
		}

		fee = (amount * pool.withdrawFee) / WITHDRAW_FEE_PRECISION;
		pool.token.safeTransfer(feeAddress, fee);
		pool.token.safeTransfer(address(_msgSender()), amount - fee);
		return (amount - fee, fee);
	}

	function withdraw(uint256 poolId, uint256 amount) public {
		PoolInfo storage pool = pools[poolId];
		UserInfo storage user = users[poolId][_msgSender()];

		require(user.balance >= amount, "Cafe: balance too low");

		// Automatic harvest
		harvest(_msgSender(), poolId);
		updateUserBalance(poolId, _msgSender(), user.balance - amount);
		(, uint256 fee) = doWithdraw(pool, amount);

		emit Withdraw(_msgSender(), poolId, amount, fee);
	}

	function emergencyWithdraw(uint256 poolId) public {
		PoolInfo storage pool = pools[poolId];
		UserInfo storage user = users[poolId][_msgSender()];

		uint256 balance = user.balance;
		updateUserBalance(poolId, _msgSender(), 0);
		(, uint256 fee) = doWithdraw(pool, balance);

		emit EmergencyWithdraw(_msgSender(), poolId, balance, fee);
	}

	function setDevAddress(address _devAddress) public {
		require(_msgSender() == devAddress, "Cafe: must be dev");
		devAddress = _devAddress;
		emit SetDevAddress(devAddress);
	}

	function setFeeAddress(address _feeAddress) external onlyRole(MANAGER_ROLE) {
		require(
			_feeAddress != address(0),
			"Cafe: feeAddress must not be the zero address"
		);
		feeAddress = _feeAddress;
		emit SetFeeAddress(feeAddress);
	}

	function updateUserPools(
		address user,
		uint256[] calldata poolIds,
		bytes calldata data
	) external override onlyRole(USER_UPDATER_ROLE) {
		if (user == address(0)) {
			return;
		}

		for (uint256 i = 0; i < poolIds.length; i++) {
			harvest(user, poolIds[i]);
			updateUserTotal(
				user,
				poolIds[i],
				rewarder.updateUserPool(poolIds[i], user, _msgSender(), data)
			);
		}
	}

	function updateUserAllPools(address user, bytes calldata data)
		external
		override
		onlyRole(USER_UPDATER_ROLE)
	{
		if (user == address(0)) {
			return;
		}

		(bool updateAll, IRewarder.UpdateResult[] memory results) = rewarder
			.updateUserAllPools(user, _msgSender(), data);

		if (updateAll) {
			for (uint256 poolId = 0; poolId < pools.length; poolId++) {
				harvest(user, poolId);
				updateUserTotal(user, poolId, rewarder.getTotal(user, poolId));
			}
		} else {
			for (uint256 i = 0; i < results.length; i++) {
				harvest(user, results[i].pool);
				updateUserTotal(user, results[i].pool, results[i].total);
			}
		}
	}

	function hasPools(uint256[] calldata poolIds)
		external
		view
		override
		returns (bool)
	{
		for (uint256 i = 0; i < poolIds.length; i++) {
			if (poolIds[i] >= pools.length) {
				return false;
			}
		}
		return true;
	}

	function setRentPerSecond(uint256 _rentPerSecond)
		public
		onlyRole(MANAGER_ROLE)
	{
		rentPerSecond = _rentPerSecond;
		emit SetRentPerSecond(rentPerSecond);
	}
}
