// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IRewarder {
	struct UpdateResult {
		uint256 pool;
		uint256 total;
	}

	function updateUserPool(
		uint256 poolId,
		address user,
		address origin,
		bytes calldata data
	) external returns (uint256 total);

	function updateUserAllPools(
		address user,
		address origin,
		bytes calldata data
	) external returns (bool updateAll, UpdateResult[] memory results);

	function updateUserBalance(
		uint256 poolId,
		address user,
		uint256 balance
	) external returns (uint256 total);

	function getTotal(address addr, uint256 poolId)
		external
		view
		returns (uint256 total);
}
