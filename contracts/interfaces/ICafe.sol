// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICafe {
	function updateUserPools(
		address user,
		uint256[] calldata poolIds,
		bytes calldata data
	) external;

	function updateUserAllPools(address user, bytes calldata data) external;

	function hasPools(uint256[] calldata poolIds) external returns (bool);
}
