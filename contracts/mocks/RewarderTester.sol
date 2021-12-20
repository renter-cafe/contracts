// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../Rewarder.sol";

contract RewarderTester {
	IRewarder private rewarder;

	event Total(uint256 indexed total);
	event PoolTotal(uint256 indexed id, uint256 indexed total);
	event UpdateResult(bool indexed updateAll, uint256 indexed count);

	constructor(IRewarder _rewarder) {
		rewarder = _rewarder;
	}

	function updateUserPool(
		uint256 poolId,
		address user,
		address,
		bytes calldata data
	) public {
		emit Total(rewarder.updateUserPool(poolId, user, address(0), data));
	}

	function updateUserAllPools(
		address user,
		address,
		bytes calldata data
	) public {
		(bool updateAll, IRewarder.UpdateResult[] memory results) = rewarder
			.updateUserAllPools(user, address(0), data);

		emit UpdateResult(updateAll, results.length);

		for (uint256 i = 0; i < results.length; i++) {
			emit PoolTotal(results[i].pool, results[i].total);
		}
	}

	function updateUserBalance(
		uint256 poolId,
		address user,
		uint256 balance
	) public {
		emit Total(rewarder.updateUserBalance(poolId, user, balance));
	}

	function getTotal(address addr, uint256 poolId)
		public
		view
		returns (uint256 total)
	{
		return rewarder.getTotal(addr, poolId);
	}
}
