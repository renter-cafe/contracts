// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../abstract/DutchAuctioneer.sol";

contract DutchAuctioneerTester is DutchAuctioneer {
	event ConfirmAuction(uint256 id, address to, uint256 price);

	mapping(uint256 => Auction) private auctions;
	mapping(uint256 => Cut[]) private cuts;

	// solhint-disable-next-line no-empty-blocks
	constructor(IERC20Burnable token) DutchAuctioneer(token) {}

	// prices[2] = [startPrice, endPrice] to avoid stack too deep
	function addAuction(
		uint256 id,
		uint256[] calldata ids,
		uint256[] calldata counts,
		uint256[] calldata weights,
		uint256[2] calldata prices,
		uint256 duration,
		uint256 startTimestamp,
		uint256 ownerCut,
		address owner
	) public {
		require(ids.length > 0, "DutchAuctioneerTester: needs items to auction");
		require(
			ids.length == counts.length && ids.length == weights.length,
			"DutchAuctioneerTester: ids and counts length mismatch"
		);
		require(
			owner != address(0) || ownerCut == 0,
			"PropertyAuction: owner cannot be null address if ownerCut is set"
		);

		for (uint256 i = 0; i < counts.length; i++) {
			require(counts[i] > 0, "DutchAuctioneerTester: all counts must be > 0");
		}

		cuts[id].push(Cut({user: owner, amount: ownerCut}));
		auctions[id] = Auction({
			ids: ids,
			counts: counts,
			weights: weights,
			startPrice: prices[0],
			endPrice: prices[1],
			duration: duration,
			startTimestamp: startTimestamp,
			done: false,
			totalWeights: getTotalWeights(weights)
		});
	}

	function getAuction(uint256 id)
		public
		view
		override
		returns (Auction memory, Cut[] memory)
	{
		return (auctions[id], cuts[id]);
	}

	function confirmAuction(
		uint256 id,
		address to,
		uint256 price
	) internal override {
		emit ConfirmAuction(id, to, price);
	}

	function currentPrice(uint256 id) public view returns (uint256) {
		(Auction memory auction, ) = getAuction(id);
		return _currentPrice(auction);
	}

	function computeCurrentPrice(
		uint256 startPrice,
		uint256 endPrice,
		uint256 duration,
		uint256 secondsElapsed
	) public pure returns (uint256) {
		return _computeCurrentPrice(startPrice, endPrice, duration, secondsElapsed);
	}
}
