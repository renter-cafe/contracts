// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../StealableProperties.sol";

contract StealerMock {
	StealableProperties private sp;

	constructor(StealableProperties _sp) {
		sp = _sp;
	}

	function steal(uint256 id) public {
		stealPrice(id, 0);
	}

	function stealPrice(uint256 id, uint256 price) public {
		sp.steal(id, msg.sender, price);
	}
}
