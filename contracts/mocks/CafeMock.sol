// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ICafe.sol";

contract CafeMock is ICafe {
	event UpdateUserPools(
		address indexed user,
		uint256[] indexed poolIds,
		bytes indexed data
	);
	event UpdateUserAllPools(address indexed user, bytes indexed data);

	mapping(uint256 => bool) private pools;

	function updateUserPools(
		address user,
		uint256[] calldata poolIds,
		bytes calldata data
	) external override {
		emit UpdateUserPools(user, poolIds, data);
	}

	function updateUserAllPools(address user, bytes calldata data)
		public
		override
	{
		emit UpdateUserAllPools(user, data);
	}

	function hasPools(uint256[] calldata poolIds)
		external
		view
		override
		returns (bool)
	{
		for (uint256 i = 0; i < poolIds.length; i++) {
			if (!pools[poolIds[i]]) {
				return false;
			}
		}
		return true;
	}

	function setPools(uint256[] calldata poolIds) public {
		for (uint256 i = 0; i < poolIds.length; i++) {
			pools[poolIds[i]] = true;
		}
	}
}
