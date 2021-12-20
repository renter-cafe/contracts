// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Context.sol";

import "../interfaces/IERC20Burnable.sol";

abstract contract DutchAuctioneer is Context {
	uint256 public constant MULTIPLIER_PRECISION = 1e4;

	struct Cut {
		address user;
		uint256 amount;
	}

	struct Auction {
		uint256[] ids;
		uint256[] counts;
		uint256[] weights;
		uint256 startPrice;
		uint256 endPrice;
		uint256 duration;
		uint256 startTimestamp;
		bool done;
		uint256 totalWeights;
	}

	IERC20Burnable public token;

	event AuctionWon(uint256 indexed id, address indexed to, uint256 price);

	constructor(IERC20Burnable _token) {
		token = _token;
	}

	function _currentPrice(Auction memory auction)
		internal
		view
		returns (uint256)
	{
		uint256 secondsElapsed = block.timestamp > auction.startTimestamp
			? block.timestamp - auction.startTimestamp
			: 0;

		return
			_computeCurrentPrice(
				auction.startPrice,
				auction.endPrice,
				auction.duration,
				secondsElapsed
			);
	}

	function _computeCurrentPrice(
		uint256 startPrice,
		uint256 endPrice,
		uint256 duration,
		uint256 secondsElapsed
	) internal pure returns (uint256) {
		if (secondsElapsed >= duration) {
			return endPrice;
		}

		int256 totalPriceChange = int256(endPrice) - int256(startPrice);
		int256 currentPriceChange = (totalPriceChange *
			int256(secondsElapsed)) / int256(duration);

		return uint256(int256(startPrice) + currentPriceChange);
	}

	function buy(uint256 id, uint256 bid) public {
		(Auction memory auction, Cut[] memory cuts) = getAuction(id);
		require(
			auction.ids.length > 0,
			"DutchAuction: this auction doesn't exist"
		);
		require(
			block.timestamp >= auction.startTimestamp,
			"DutchAuction: this auction hasn't started yet"
		);

		uint256 price = _currentPrice(auction);
		require(bid >= price, "DutchAuction: bid too low");

		if (price > 0) {
			uint256 cutSum = 0;
			uint256 cutTotal = 0;

			for (uint256 i = 0; i < cuts.length; i++) {
				uint256 cut = (price * cuts[i].amount) / MULTIPLIER_PRECISION;
				cutSum += cut;
				cutTotal += cuts[i].amount;

				if (cut > 0) {
					token.transferFrom(_msgSender(), cuts[i].user, cut);
				}
			}

			require(
				cutTotal <= MULTIPLIER_PRECISION && cutSum <= price,
				"DutchAuction: sum of cut amounts too high"
			);

			if (price != cutSum) {
				token.burnFrom(_msgSender(), price - cutSum);
			}
		}

		confirmAuction(id, _msgSender(), price);
		emit AuctionWon(id, _msgSender(), price);
	}

	function getTotalWeights(uint256[] memory weights)
		internal
		virtual
		returns (uint256 totalWeights)
	{
		for (uint256 i = 0; i < weights.length; i++) {
			require(weights[i] > 0, "DutchAuction: all weights must be > 0");
			totalWeights += weights[i];
		}
		return totalWeights;
	}

	function getAuction(uint256 id)
		public
		virtual
		returns (Auction memory auction, Cut[] memory cuts);

	function confirmAuction(
		uint256 id,
		address to,
		uint256 price
	) internal virtual;
}
