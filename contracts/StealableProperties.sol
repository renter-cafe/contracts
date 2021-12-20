// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import "./interfaces/ICafe.sol";
import "./interfaces/IMintableERC1155.sol";

contract StealableProperties is
	Context,
	AccessControlEnumerable,
	ERC1155Pausable
{
	bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
	bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
	bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
	bytes32 public constant STEALER_ROLE = keccak256("STEALER_ROLE");
	uint256 public constant MULTIPLIER_PRECISION = 1e4;

	struct Owner {
		address user;
		uint256 since;
		uint256 price;
	}

	struct Property {
		uint256 id;
		uint256 cap;
		uint256 minted;
		uint256[] poolIds;
		uint256 multiplier;
		uint256 bonus;
		uint256 protection;
		uint256 startRatio;
		uint256 endRatio;
		uint256 duration;
		uint256 keepRatio;
		uint256 index;
		uint256 stealMints;
		uint256 stealMintsDone;
	}

	event PropertyCreated(
		uint256 indexed id,
		uint256 cap,
		uint256[] poolIds,
		uint256 multiplier,
		uint256 bonus,
		uint256 protection,
		uint256 startRatio,
		uint256 endRatio,
		uint256 duration,
		uint256 keepRatio,
		uint256 stealMints
	);
	event PropertyStolen(
		uint256 indexed id,
		address indexed by,
		address indexed from,
		uint256 price,
		bool stealMint
	);
	event PropertyMinted(
		address indexed to,
		uint256 indexed id,
		uint256 amount,
		uint256 price
	);
	event SetURI(string uri);

	mapping(uint256 => Property) private _properties;
	mapping(uint256 => Owner[]) private _owners;

	ICafe private cafe;
	IMintableERC1155 private upstream;

	constructor(
		ICafe _cafe,
		IMintableERC1155 _upstream,
		string memory uri
	) ERC1155(uri) {
		cafe = _cafe;
		upstream = _upstream;

		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
		_setupRole(MANAGER_ROLE, _msgSender());
		_setupRole(MINTER_ROLE, _msgSender());
		_setupRole(PAUSER_ROLE, _msgSender());
		_setupRole(CREATOR_ROLE, _msgSender());
		_setupRole(STEALER_ROLE, _msgSender());
	}

	function create(
		uint256 id,
		uint256 cap,
		uint256[] calldata poolIds,
		uint256 multiplier,
		uint256 bonus,
		uint256 protection,
		uint256 startRatio,
		uint256 endRatio,
		uint256 duration,
		uint256 keepRatio,
		uint256 stealMints
	) public onlyRole(CREATOR_ROLE) {
		require(cap > 0, "StealableProperties: cap must be > 0");
		require(
			_properties[id].cap == 0,
			"StealableProperties: property with given id already exists"
		);
		require(
			cafe.hasPools(poolIds),
			"StealableProperties: Cafe needs to have all pools"
		);

		_properties[id] = Property({
			id: id,
			cap: cap,
			minted: 0,
			poolIds: poolIds,
			multiplier: multiplier,
			bonus: bonus,
			protection: protection,
			index: 0,
			startRatio: startRatio,
			endRatio: endRatio,
			duration: duration,
			keepRatio: keepRatio,
			stealMints: stealMints,
			stealMintsDone: 0
		});

		emit PropertyCreated(
			id,
			cap,
			poolIds,
			multiplier,
			bonus,
			protection,
			startRatio,
			endRatio,
			duration,
			keepRatio,
			stealMints
		);
	}

	function _insertOwnersRight(
		uint256 id,
		address user,
		uint256 price,
		uint256 count
	) private {
		uint256 index = _properties[id].index;
		Owner[] storage owners = _owners[id];

		for (uint256 i = owners.length - 1; i >= index + count; i--) {
			owners[i] = owners[i - count];
		}

		for (uint256 i = 0; i < count; i++) {
			owners[i + index] = Owner({
				user: user,
				since: block.timestamp,
				price: price
			});
		}

		_properties[id].index = (_properties[id].index + count) % owners.length;
	}

	function _insertOwnersLeft(
		uint256 id,
		address user,
		uint256 price,
		uint256 count
	) private {
		Property storage property = _properties[id];
		Owner[] storage owners = _owners[id];
		uint256 start = owners.length - count;

		for (uint256 i = 0; i < property.index; i++) {
			uint256 toIndex = (start + i) % owners.length;
			uint256 fromIndex = (start + i + count) % owners.length;
			owners[toIndex] = owners[fromIndex];
		}

		for (uint256 i = 0; i < count; i++) {
			uint256 index = (start + property.index + i) % owners.length;
			owners[index] = Owner({user: user, since: block.timestamp, price: price});
		}
	}

	function _insertOwner(
		uint256 id,
		address user,
		uint256 price,
		uint256 count
	) private {
		Property storage property = _properties[id];
		Owner[] storage owners = _owners[id];

		for (uint256 i = 0; i < count; i++) {
			owners.push();
		}

		if (property.index > property.minted / 2) {
			_insertOwnersRight(id, user, price, count);
		} else {
			_insertOwnersLeft(id, user, price, count);
		}
	}

	function mint(
		address to,
		uint256 id,
		uint256 amount,
		uint256 price,
		bytes memory data
	) public virtual onlyRole(MINTER_ROLE) {
		require(
			_properties[id].minted + amount <= _properties[id].cap,
			"StealableProperties: additional amount must not exceed cap"
		);

		_insertOwner(id, to, price, amount);
		_properties[id].minted += amount;
		_mint(to, id, amount, data);
		upstream.mint(to, id, amount, data);

		emit PropertyMinted(to, id, amount, price);
	}

	function pause() public virtual onlyRole(PAUSER_ROLE) {
		_pause();
	}

	function unpause() public virtual onlyRole(PAUSER_ROLE) {
		_unpause();
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

	function updateOwners(
		uint256 id,
		address from,
		address to,
		uint256 count
	) private {
		// Ignore on mint
		if (from == address(0)) {
			return;
		}

		Property storage property = _properties[id];
		Owner[] storage owners = _owners[id];
		uint256 done = 0;

		for (uint256 i = 0; i < owners.length; i++) {
			uint256 index = (i + property.index) % property.minted;
			if (owners[index].user == from) {
				owners[index].user = to;
				done++;
			}
			if (done == count) {
				return;
			}
		}

		revert("StealableProperties: owner not found on transfer");
	}

	function _beforeTokenTransfer(
		address operator,
		address from,
		address to,
		uint256[] memory ids,
		uint256[] memory amounts,
		bytes memory data
	) internal virtual override {
		super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

		for (uint256 i = 0; i < ids.length; i++) {
			Property storage property = _properties[ids[i]];
			uint256 amount = amounts[i];

			int256 multiplier = int256(amount * property.multiplier);
			int256 bonus = int256(amount * property.bonus);

			bytes memory fromData = abi.encode(-multiplier, -bonus);
			bytes memory toData = abi.encode(multiplier, bonus);

			if (property.poolIds.length == 0) {
				cafe.updateUserAllPools(from, fromData);
				cafe.updateUserAllPools(to, toData);
			} else {
				cafe.updateUserPools(from, property.poolIds, fromData);
				cafe.updateUserPools(to, property.poolIds, toData);
			}

			updateOwners(ids[i], from, to, amount);
		}
	}

	function getProperty(uint256 id)
		public
		view
		returns (Property memory property)
	{
		return _properties[id];
	}

	function getOwners(uint256 id) public view returns (Owner[] memory owners) {
		return _owners[id];
	}

	function steal(
		uint256 id,
		address to,
		uint256 price
	) external onlyRole(STEALER_ROLE) {
		Property storage property = _properties[id];

		require(
			property.minted > 0,
			"StealableProperties: property not available for stealing"
		);

		Owner storage owner = _owners[id][property.index];

		require(
			block.timestamp - owner.since >= property.protection,
			"StealableProperties: property still protected"
		);

		_safeTransferFrom(owner.user, to, id, 1, "");

		bool shouldMint = property.stealMintsDone < property.stealMints;
		if (shouldMint) {
			property.stealMintsDone++;
			upstream.mint(to, id, 1, "");
		}

		owner.since = block.timestamp;
		owner.price = price;
		property.index = (property.index + 1) % property.minted;

		emit PropertyStolen(id, to, owner.user, price, shouldMint);
	}

	function setURI(string memory uri) public onlyRole(MANAGER_ROLE) {
		_setURI(uri);
		emit SetURI(uri);
	}
}
