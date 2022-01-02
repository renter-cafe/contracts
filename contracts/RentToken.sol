// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RentToken is
	ERC20("Renter.Cafe", "RENT"),
	ERC20Capped(10_000_000 * 1e18),
	Ownable,
	ERC20Burnable
{
	function _mint(address account, uint256 amount)
		internal
		virtual
		override(ERC20, ERC20Capped)
	{
		ERC20Capped._mint(account, amount);
	}

	function mint(address account, uint256 amount) public onlyOwner {
		_mint(account, amount);
	}
}
