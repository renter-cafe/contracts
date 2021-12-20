const { expect } = require('chai')
const { ethers } = require('hardhat')

const Evm = require('./lib/evm')
const { cleanOutput } = require('./lib/tools')

describe('DutchAuctioneer', async () => {
	let alice, bob
	let rent, da

	const evm = Evm(ethers)
	const zeroAddr = ethers.constants.AddressZero

	beforeEach(async () => {
		;[, alice, bob] = await ethers.getSigners()

		const RENT = await ethers.getContractFactory('RentToken')
		const DA = await ethers.getContractFactory('DutchAuctioneerTester')

		rent = await RENT.deploy()
		da = await DA.deploy(rent.address)
	})

	describe('mock', () => {
		it('has token getter', async () => {
			expect(await da.token()).to.equal(rent.address)
		})

		describe('add auction', () => {
			it('reverts without any items', async () => {
				const tx = da.addAuction(0, [], [], [], [200, 100], 0, 0, 0, zeroAddr)
				await expect(tx).to.revertedWith(
					'DutchAuctioneerTester: needs items to auction'
				)
			})

			it('reverts with different ids and counts lengths', async () => {
				let tx = da.addAuction(0, [1], [1], [], [0, 0], 0, 0, 0, zeroAddr)
				await expect(tx).to.revertedWith(
					'DutchAuctioneerTester: ids and counts length mismatch'
				)

				tx = da.addAuction(0, [1], [], [1], [0, 0], 0, 0, 0, zeroAddr)
				await expect(tx).to.revertedWith(
					'DutchAuctioneerTester: ids and counts length mismatch'
				)

				tx = da.addAuction(0, [1], [], [], [0, 0], 0, 0, 0, zeroAddr)
				await expect(tx).to.revertedWith(
					'DutchAuctioneerTester: ids and counts length mismatch'
				)
			})

			it('reverts with count = 0', async () => {
				const tx = da.addAuction(
					0,
					[1, 2],
					[1, 0],
					[1, 2],
					[200, 100],
					1000,
					0,
					0,
					zeroAddr
				)
				await expect(tx).to.revertedWith(
					'DutchAuctioneerTester: all counts must be > 0'
				)
			})

			it('reverts when owner is not set with ownerCut > 0', async () => {
				const tx = da.addAuction(
					0,
					[1],
					[1],
					[1],
					[200, 100],
					50,
					1,
					1,
					zeroAddr
				)
				await expect(tx).to.revertedWith(
					'PropertyAuction: owner cannot be null address if ownerCut is set'
				)
			})

			it('reverts with weight = 0', async () => {
				const tx = da.addAuction(
					0,
					[1, 2],
					[1, 1],
					[0, 2],
					[200, 100],
					1000,
					0,
					0,
					zeroAddr
				)
				await expect(tx).to.revertedWith(
					'DutchAuction: all weights must be > 0'
				)
			})
		})

		describe('get auction', () => {
			it('can get an auction', async () => {
				await da.addAuction(
					0,
					[2, 5],
					[3, 8],
					[4, 6],
					[200, 100],
					1000,
					2000,
					0,
					zeroAddr
				)
				await expect(cleanOutput(await da.getAuction(0))).to.deep.equal([
					{
						ids: [2n, 5n],
						counts: [3n, 8n],
						weights: [4n, 6n],
						startPrice: 200n,
						endPrice: 100n,
						duration: 1000n,
						startTimestamp: 2000n,
						done: false,
						totalWeights: 10n,
					},
					[
						{
							user: ethers.constants.AddressZero,
							amount: 0n,
						},
					],
				])
			})
		})
	})

	describe('initial state', () => {
		it('has multiplier constants', async () => {
			expect(await da.MULTIPLIER_PRECISION()).to.equal(10000)
		})
	})

	describe('compute current price', () => {
		it('works for increasing price', async function () {
			const [start, end, dur] = [100, 500, 1000]
			expect(await da.computeCurrentPrice(start, end, dur, 0)).to.equal(start)
			expect(await da.computeCurrentPrice(start, end, dur, 100)).to.equal(140)
			expect(await da.computeCurrentPrice(start, end, dur, 500)).to.equal(300)
			expect(await da.computeCurrentPrice(start, end, dur, 1000)).to.equal(500)
			expect(await da.computeCurrentPrice(start, end, dur, 5000)).to.equal(500)
		})

		it('works for decreasing price', async function () {
			const [start, end, dur] = [200, 100, 1000]
			expect(await da.computeCurrentPrice(start, end, dur, 0)).to.equal(200)
			expect(await da.computeCurrentPrice(start, end, dur, 100)).to.equal(190)
			expect(await da.computeCurrentPrice(start, end, dur, 600)).to.equal(140)
			expect(await da.computeCurrentPrice(start, end, dur, 1000)).to.equal(100)
			expect(await da.computeCurrentPrice(start, end, dur, 5000)).to.equal(100)
		})

		it('works for fixed price', async function () {
			const [start, end, dur] = [100, 100, 1000]
			expect(await da.computeCurrentPrice(start, end, dur, 0)).to.equal(100)
			expect(await da.computeCurrentPrice(start, end, dur, 100)).to.equal(100)
			expect(await da.computeCurrentPrice(start, end, dur, 5000)).to.equal(100)
		})

		it('works down to zero', async function () {
			const [start, end, dur] = [100, 0, 1000]
			expect(await da.computeCurrentPrice(start, end, dur, 0)).to.equal(100)
			expect(await da.computeCurrentPrice(start, end, dur, 100)).to.equal(90)
			expect(await da.computeCurrentPrice(start, end, dur, 5000)).to.equal(0)
		})

		it('works up from zero', async function () {
			const [start, end, dur] = [0, 100, 1000]
			expect(await da.computeCurrentPrice(start, end, dur, 0)).to.equal(0)
			expect(await da.computeCurrentPrice(start, end, dur, 100)).to.equal(10)
			expect(await da.computeCurrentPrice(start, end, dur, 5000)).to.equal(100)
		})

		it('works for always zero', async function () {
			const [start, end, dur] = [0, 0, 1000]
			expect(await da.computeCurrentPrice(start, end, dur, 0)).to.equal(0)
			expect(await da.computeCurrentPrice(start, end, dur, 100)).to.equal(0)
			expect(await da.computeCurrentPrice(start, end, dur, 5000)).to.equal(0)
		})

		it('works for big numbers', async function () {
			const [start, end, dur] = [
				100000000000000000000n,
				200000000000000000000n,
				100000n,
			]
			expect(await da.computeCurrentPrice(start, end, dur, 0)).to.equal(start)
			expect(await da.computeCurrentPrice(start, end, dur, 10000)).to.equal(
				110000000000000000000n
			)
			expect(await da.computeCurrentPrice(start, end, dur, 60000)).to.equal(
				160000000000000000000n
			)
			expect(await da.computeCurrentPrice(start, end, dur, 100000)).to.equal(
				end
			)
			expect(await da.computeCurrentPrice(start, end, dur, 500000)).to.equal(
				end
			)
		})
	})

	describe('current price based on block time', async () => {
		it('works from start to end', async () => {
			const { timestamp } = await ethers.provider.getBlock()
			const start = timestamp + 100

			await evm.setNextBlockTimestamp(timestamp + 1)
			await da.addAuction(
				0,
				[1],
				[1],
				[1],
				[200, 100],
				1000,
				start,
				0,
				zeroAddr
			)

			expect(await da.currentPrice(0)).to.equal(200)

			await evm.setNextBlockTimestamp(start)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(200)

			await evm.increaseTime(100)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(190)

			await evm.increaseTime(500)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(140)

			await evm.increaseTime(400)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(100)

			await evm.increaseTime(4000)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(100)
		})
	})

	describe('buy', () => {
		it('reverts when auction does not exist', async () => {
			const tx = da.buy(0, 100)
			await expect(tx).to.revertedWith(
				"DutchAuction: this auction doesn't exist"
			)
		})

		it('reverts when auction has not started yet', async () => {
			const { timestamp } = await ethers.provider.getBlock()
			await evm.setNextBlockTimestamp(timestamp + 1)
			await da.addAuction(
				0,
				[1],
				[1],
				[1],
				[200, 100],
				1000,
				timestamp + 3,
				0,
				zeroAddr
			)

			const tx = da.buy(0, 100)
			await expect(tx).to.revertedWith(
				"DutchAuction: this auction hasn't started yet"
			)
		})

		it('reverts with invalid owner cut', async () => {
			await da.addAuction(
				0,
				[1],
				[1],
				[1],
				[200, 100],
				1000,
				1,
				10001,
				bob.address
			)
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(da.address, 200)

			const tx = da.connect(alice).buy(0, 100)
			await expect(tx).to.revertedWith(
				'DutchAuction: sum of cut amounts too high'
			)
		})

		it('reverts when bid is too low', async () => {
			await da.addAuction(0, [1], [1], [1], [200, 100], 0, 1, 0, zeroAddr)

			const tx = da.buy(0, 99)
			await expect(tx).to.revertedWith('DutchAuction: bid too low')
		})

		it('reverts when user balance is too low', async () => {
			await da.addAuction(0, [1], [1], [1], [100, 100], 0, 1, 100, bob.address)
			await expect(da.connect(alice).buy(0, 100)).to.revertedWith(
				'ERC20: transfer amount exceeds balance'
			)

			await da.addAuction(1, [1], [1], [1], [100, 100], 0, 1, 0, zeroAddr)
			await expect(da.connect(alice).buy(1, 100)).to.revertedWith(
				'ERC20: burn amount exceeds allowance'
			)
		})

		it('reverts when approved balance is too low', async () => {
			await rent.mint(alice.address, 200)
			await da.addAuction(0, [1], [1], [1], [100, 100], 0, 1, 100, bob.address)
			await expect(da.connect(alice).buy(0, 200)).to.revertedWith(
				'ERC20: transfer amount exceeds allowance'
			)

			await rent.connect(alice).approve(da.address, 1)
			await expect(da.connect(alice).buy(0, 200)).to.revertedWith(
				'ERC20: burn amount exceeds allowance'
			)
		})

		it('works with owner cut', async () => {
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(da.address, 200)

			const { timestamp } = await ethers.provider.getBlock()
			const start = timestamp + 100

			await evm.setNextBlockTimestamp(timestamp + 1)
			await da.addAuction(
				0,
				[1],
				[1],
				[1],
				[300, 100],
				1000,
				start,
				4000,
				bob.address
			)

			await evm.setNextBlockTimestamp(start + 500)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(200)

			const tx = await da.connect(alice).buy(0, 250)
			await expect(tx)
				.to.emit(da, 'ConfirmAuction')
				.withArgs(0, alice.address, 200)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, bob.address, 80)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, zeroAddr, 120)
			await expect(tx).to.emit(da, 'AuctionWon').withArgs(0, alice.address, 200)
		})

		it('works without owner cut', async () => {
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(da.address, 200)

			const { timestamp } = await ethers.provider.getBlock()
			const start = timestamp + 100

			await evm.setNextBlockTimestamp(timestamp + 1)
			await da.addAuction(
				0,
				[1],
				[1],
				[1],
				[300, 100],
				1000,
				start,
				0,
				zeroAddr
			)

			await evm.setNextBlockTimestamp(start + 500)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(200)

			const tx = await da.connect(alice).buy(0, 250)
			await expect(tx)
				.to.emit(da, 'ConfirmAuction')
				.withArgs(0, alice.address, 200)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, zeroAddr, 200)
			await expect(tx).to.emit(da, 'AuctionWon').withArgs(0, alice.address, 200)
		})

		it('works with owner cut of 100%', async () => {
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(da.address, 200)

			const { timestamp } = await ethers.provider.getBlock()
			const start = timestamp + 100

			await evm.setNextBlockTimestamp(timestamp + 1)
			await da.addAuction(
				0,
				[1],
				[1],
				[1],
				[200, 200],
				0,
				1,
				10000,
				bob.address
			)

			await evm.setNextBlockTimestamp(start + 500)
			await evm.mine()

			expect(await da.currentPrice(0)).to.equal(200)

			const tx = await da.connect(alice).buy(0, 250)
			await expect(tx)
				.to.emit(da, 'ConfirmAuction')
				.withArgs(0, alice.address, 200)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, bob.address, 200)
			await expect(tx).to.emit(da, 'AuctionWon').withArgs(0, alice.address, 200)
		})

		it('works with a price of 0', async () => {
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(da.address, 200)
			await da.addAuction(0, [1], [1], [1], [0, 0], 0, 1, 0, zeroAddr)

			expect(await da.currentPrice(0)).to.equal(0)

			const tx = await da.connect(alice).buy(0, 0)
			await expect(tx)
				.to.emit(da, 'ConfirmAuction')
				.withArgs(0, alice.address, 0)
			await expect(tx).to.emit(da, 'AuctionWon').withArgs(0, alice.address, 0)
		})
	})
})
