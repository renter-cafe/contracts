// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "./abstract/DutchAuctioneer.sol";
import "./StealableProperties.sol";

contract StealAuction is DutchAuctioneer {
	StealableProperties private sp;

	constructor(StealableProperties _sp, IERC20Burnable token)
		DutchAuctioneer(token)
	{
		sp = _sp;
	}

	function getAuction(uint256 id)
		public
		view
		override
		returns (Auction memory, Cut[] memory)
	{
		StealableProperties.Property memory property = sp.getProperty(id);

		require(property.minted > 0, "StealAuction: property does not exist");

		StealableProperties.Owner memory owner = sp.getOwners(id)[property.index];

		uint256[] memory ids = new uint256[](1);
		uint256[] memory counts = new uint256[](1);
		uint256[] memory weights = new uint256[](1);
		Cut[] memory cuts = new Cut[](1);

		ids[0] = id;
		counts[0] = 1;
		weights[0] = 1;
		cuts[0] = Cut({user: owner.user, amount: property.keepRatio});

		return (
			Auction({
				ids: ids,
				counts: counts,
				weights: weights,
				startPrice: (owner.price * property.startRatio) / MULTIPLIER_PRECISION,
				endPrice: (owner.price * property.endRatio) / MULTIPLIER_PRECISION,
				duration: property.duration,
				startTimestamp: owner.since + property.protection,
				done: false,
				totalWeights: 1
			}),
			cuts
		);
	}

	function confirmAuction(
		uint256 id,
		address to,
		uint256 price
	) internal override {
		sp.steal(id, to, price);
	}
}
