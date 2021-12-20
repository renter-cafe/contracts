const { expect } = require('chai')
const { ethers } = require('hardhat')

const { cleanOutput, keccak256, expectRevertWithRole } = require('./lib/tools')
const Evm = require('./lib/evm')

describe('StealAuction', async () => {
	let alice, bob
	let rent, cafe, sp, sa, properties

	const evm = Evm(ethers)

	beforeEach(async () => {
		;[, alice, bob] = await ethers.getSigners()

		const RENT = await ethers.getContractFactory('RentToken')
		const Cafe = await ethers.getContractFactory('CafeMock')
		const SP = await ethers.getContractFactory('StealableProperties')
		const SA = await ethers.getContractFactory('StealAuction')
		const Properties = await ethers.getContractFactory('Properties')

		rent = await RENT.deploy()
		cafe = await Cafe.deploy()
		properties = await Properties.deploy('')
		sp = await SP.deploy(cafe.address, properties.address, '')
		sa = await SA.deploy(sp.address, rent.address)

		await properties.grantRole(keccak256('MINTER_ROLE'), sp.address)
	})

	describe('get auction', () => {
		it('reverts if the property cannot be stolen', async () => {
			const tx = sa.getAuction(0)
			expect(tx).to.revertedWith('StealAuction: property does not exist')
		})

		it('returns an auction if it exists', async () => {
			await sp.create(0, 3, [], 0, 0, 234567, 100000, 100000, 0, 5000, 0)
			const { blockNumber } = await sp.mint(alice.address, 0, 1, 5, [])
			const { timestamp } = await ethers.provider.getBlock(blockNumber)

			expect(cleanOutput(await sa.getAuction(0))).to.deep.equal([
				{
					ids: [0n],
					counts: [1n],
					weights: [1n],
					startPrice: 50n,
					endPrice: 50n,
					duration: 0n,
					startTimestamp: BigInt(timestamp) + 234567n,
					done: false,
					totalWeights: 1n,
				},
				[
					{
						amount: 5000n,
						user: alice.address,
					},
				],
			])
		})
	})

	describe('confirm auction', () => {
		it('cannot steal if StealAuction does not have the stealer role', async () => {
			// Create property and auction
			await sp.create(0, 1, [], 0, 0, 0, 0, 0, 0, 0, 0)
			await sp.mint(alice.address, 0, 1, 5, [])

			// Give RENT and approve
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(sa.address, 200)

			// Try to buy
			const tx = sa.connect(alice).buy(0, 100)
			await expectRevertWithRole(tx, sa.address, 'STEALER_ROLE')
		})

		it('works with valid state', async () => {
			await sp.grantRole(keccak256('STEALER_ROLE'), sa.address)
			await rent.mint(bob.address, 300)
			await rent.connect(bob).approve(sa.address, 300)
			await sp.create(0, 4, [], 0, 0, 0, 55000, 5000, 1000, 1000, 0)

			const { blockNumber } = await sp.mint(alice.address, 0, 1, 100, [])
			const { timestamp } = await ethers.provider.getBlock(blockNumber)

			await evm.setNextBlockTimestamp(timestamp + 500)
			await evm.mine()

			const tx = await sa.connect(bob).buy(0, 300)
			await expect(tx)
				.to.emit(sp, 'TransferSingle')
				.withArgs(sa.address, alice.address, bob.address, 0n, 1n)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(bob.address, ethers.constants.AddressZero, 270)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(bob.address, alice.address, 30)
		})
	})
})
