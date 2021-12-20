const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('RENT', async () => {
	let alice
	let token

	beforeEach(async () => {
		;[, alice] = await ethers.getSigners()

		const Token = await ethers.getContractFactory('RentToken')

		token = await Token.deploy()
	})

	it('can mint tokens', async () => {
		const amount = 1000n

		await expect(token.mint(alice.address, amount))
			.to.emit(token, 'Transfer')
			.withArgs(ethers.constants.AddressZero, alice.address, amount)

		expect(await token.balanceOf(alice.address)).to.equal(amount)
	})
})
