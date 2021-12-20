// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "./interfaces/IRewarder.sol";

contract Rewarder is AccessControlEnumerable, IRewarder {
	bytes32 public constant USER_UPDATER_ROLE = keccak256("USER_UPDATER_ROLE");
	uint256 public constant MULTIPLIER_PRECISION = 1e4;

	struct UserPool {
		uint256 balance;
		uint256 multiplier;
		uint256 bonus;
	}

	struct UserGlobal {
		uint256 multiplier;
		uint256 bonus;
	}

	struct User {
		uint256[] active;
		mapping(uint256 => uint256) activeMap;
		mapping(uint256 => UserPool) pools;
		UserGlobal global;
	}

	mapping(address => User) private users;

	event UserBalanceUpdated(
		uint256 indexed poolId,
		address indexed user,
		uint256 balance
	);
	event UserAllPoolsUpdated(
		address indexed user,
		uint256 multiplier,
		uint256 bonus
	);
	event UserPoolUpdated(
		uint256 indexed poolId,
		address indexed user,
		uint256 multiplier,
		uint256 bonus
	);

	constructor() {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
		_setupRole(USER_UPDATER_ROLE, _msgSender());
	}

	function getTotal(address addr, uint256 poolId)
		public
		view
		override
		returns (uint256 total)
	{
		User storage user = users[addr];
		UserPool storage pool = user.pools[poolId];
		UserGlobal storage global = user.global;

		uint256 multiplier = pool.multiplier + global.multiplier;
		uint256 balance = pool.balance + pool.bonus + global.bonus;

		return
			(balance * (MULTIPLIER_PRECISION + multiplier)) / MULTIPLIER_PRECISION;
	}

	function addInt(uint256 a, int256 b) private pure returns (uint256) {
		return b >= 0 ? a + uint256(b) : a - uint256(-b);
	}

	function toggleActive(uint256 poolId, address addr) private {
		User storage user = users[addr];
		UserPool storage pool = user.pools[poolId];

		bool shouldBeActive = pool.balance > 0 || pool.bonus > 0;
		bool isActive = user.active.length > user.activeMap[poolId] &&
			user.active[user.activeMap[poolId]] == poolId;

		// Mark pool as active
		if (shouldBeActive && !isActive) {
			user.activeMap[poolId] = user.active.length;
			user.active.push(poolId);
		}
		// Mark pool as inactive
		else if (!shouldBeActive && isActive) {
			user.active[user.activeMap[poolId]] = user.active[user.active.length - 1];
			user.active.pop();
		}
	}

	function updateUserPool(
		uint256 poolId,
		address addr,
		address,
		bytes calldata data
	) external override onlyRole(USER_UPDATER_ROLE) returns (uint256 total) {
		UserPool storage pool = users[addr].pools[poolId];
		(int256 multiplier, int256 bonus) = abi.decode(data, (int256, int256));

		pool.multiplier = addInt(pool.multiplier, multiplier);
		pool.bonus = addInt(pool.bonus, bonus);
		toggleActive(poolId, addr);

		emit UserPoolUpdated(poolId, addr, pool.multiplier, pool.bonus);
		return getTotal(addr, poolId);
	}

	function updateUserAllPools(
		address addr,
		address,
		bytes calldata data
	)
		external
		override
		onlyRole(USER_UPDATER_ROLE)
		returns (bool updateAll, UpdateResult[] memory results)
	{
		User storage user = users[addr];
		UserGlobal storage pool = user.global;

		// Decode the data
		(int256 multiplier, int256 bonus) = abi.decode(data, (int256, int256));

		// Update the pool
		pool.multiplier = addInt(pool.multiplier, multiplier);
		pool.bonus = addInt(pool.bonus, bonus);

		// Emit event
		emit UserAllPoolsUpdated(addr, pool.multiplier, pool.bonus);

		// If it's a global bonus, all pools need to be updated
		if (bonus != 0 || pool.bonus != 0) {
			return (true, new UpdateResult[](0));
		}

		// If not, return the totals of each active pool
		results = new UpdateResult[](user.active.length);

		for (uint256 i = 0; i < user.active.length; i++) {
			results[i] = UpdateResult({
				pool: user.active[i],
				total: getTotal(addr, user.active[i])
			});
		}

		return (false, results);
	}

	function updateUserBalance(
		uint256 poolId,
		address addr,
		uint256 balance
	) external override onlyRole(USER_UPDATER_ROLE) returns (uint256 total) {
		User storage user = users[addr];
		UserPool storage pool = user.pools[poolId];

		pool.balance = balance;
		toggleActive(poolId, addr);

		emit UserBalanceUpdated(poolId, addr, balance);
		return getTotal(addr, poolId);
	}
}
