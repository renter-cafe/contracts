// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LPMock is ERC20 {
	address public token0;
	address public token1;

	constructor(
		string memory name,
		string memory symbol,
		uint256 supply,
		address _token0,
		address _token1
	) ERC20(name, symbol) {
		_mint(msg.sender, supply);
		token0 = _token0;
		token1 = _token1;
	}
}
