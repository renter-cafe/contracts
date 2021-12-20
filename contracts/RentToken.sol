// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RentToken is ERC20("RentToken", "RENT"), Ownable, ERC20Burnable {
	function mint(address account, uint256 amount) public onlyOwner {
		_mint(account, amount);
	}
}
