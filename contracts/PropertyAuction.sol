// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "./abstract/DutchAuctioneer.sol";
import "./StealableProperties.sol";

contract PropertyAuction is AccessControlEnumerable, DutchAuctioneer {
	bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

	Auction[] public auctions;
	Cut[] public cuts;

	StealableProperties public immutable sp;

	event CutsSet(Cut[] cuts);
	event AuctionAdded(
		uint256 id,
		uint256[] ids,
		uint256[] counts,
		uint256[] weights,
		uint256 startPrice,
		uint256 endPrice,
		uint256 duration,
		uint256 startTimestamp
	);

	constructor(StealableProperties _sp, IERC20Burnable token)
		DutchAuctioneer(token)
	{
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
		_setupRole(MINTER_ROLE, _msgSender());
		_setupRole(MANAGER_ROLE, _msgSender());

		sp = _sp;
	}

	function addAuction(
		uint256[] calldata ids,
		uint256[] calldata counts,
		uint256[] calldata weights,
		uint256 startPrice,
		uint256 endPrice,
		uint256 duration,
		uint256 startTimestamp
	) public onlyRole(MINTER_ROLE) {
		require(ids.length > 0, "PropertyAuction: needs items to auction");
		require(
			ids.length == counts.length && ids.length == weights.length,
			"PropertyAuction: ids, counts and weights length mismatch"
		);

		for (uint256 i = 0; i < counts.length; i++) {
			require(counts[i] > 0, "PropertyAuction: all counts must be > 0");
			require(
				sp.getProperty(ids[i]).cap > 0,
				"PropertyAuction: all properties need to exist"
			);
		}

		emit AuctionAdded(
			auctions.length,
			ids,
			counts,
			weights,
			startPrice,
			endPrice,
			duration,
			startTimestamp
		);

		auctions.push(
			Auction({
				ids: ids,
				counts: counts,
				weights: weights,
				startPrice: startPrice,
				endPrice: endPrice,
				duration: duration,
				startTimestamp: startTimestamp,
				done: false,
				totalWeights: getTotalWeights(weights)
			})
		);
	}

	function getAuction(uint256 id)
		public
		view
		override
		returns (Auction memory, Cut[] memory)
	{
		return (auctions[id], cuts);
	}

	function confirmAuction(
		uint256 id,
		address to,
		uint256 price
	) internal override {
		Auction storage auction = auctions[id];
		require(!auction.done, "PropertyAuction: auction already won");

		auction.done = true;

		for (uint256 i = 0; i < auction.ids.length; i++) {
			sp.mint(
				to,
				auction.ids[i],
				auction.counts[i],
				(price * auction.weights[i]) / auction.totalWeights / auction.counts[i],
				""
			);
		}
	}

	function setCuts(Cut[] calldata _cuts) public onlyRole(MANAGER_ROLE) {
		delete cuts;
		uint256 cutTotal = 0;

		for (uint256 i = 0; i < _cuts.length; i++) {
			cuts.push(_cuts[i]);
			cutTotal += _cuts[i].amount;
		}

		require(
			cutTotal <= MULTIPLIER_PRECISION,
			"PropertyAuction: sum of cut amounts too high"
		);

		emit CutsSet(cuts);
	}
}
