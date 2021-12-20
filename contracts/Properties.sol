// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "./interfaces/IMintableERC1155.sol";

contract Properties is ERC1155, AccessControlEnumerable, IMintableERC1155 {
	bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

	event SetURI(string uri);

	constructor(string memory uri) ERC1155(uri) {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
		_setupRole(MANAGER_ROLE, _msgSender());
		_setupRole(MINTER_ROLE, _msgSender());
	}

	function mint(
		address to,
		uint256 id,
		uint256 amount,
		bytes memory data
	) public override onlyRole(MINTER_ROLE) {
		super._mint(to, id, amount, data);
	}

	function mintBatch(
		address to,
		uint256[] memory ids,
		uint256[] memory amounts,
		bytes memory data
	) public onlyRole(MINTER_ROLE) {
		super._mintBatch(to, ids, amounts, data);
	}

	function supportsInterface(bytes4 interfaceId)
		public
		view
		virtual
		override(AccessControlEnumerable, ERC1155)
		returns (bool)
	{
		return super.supportsInterface(interfaceId);
	}

	function setURI(string memory uri) public onlyRole(MANAGER_ROLE) {
		_setURI(uri);
		emit SetURI(uri);
	}
}
