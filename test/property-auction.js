const { expect } = require('chai')
const { ethers } = require('hardhat')

const { cleanOutput, keccak256, expectRevertWithRole } = require('./lib/tools')
const Evm = require('./lib/evm')

describe('PropertyAuction', async () => {
	let alice, bob, carol
	let rent, cafe, sp, pa, properties

	const evm = Evm(ethers)

	beforeEach(async () => {
		;[, alice, bob, carol] = await ethers.getSigners()

		const RENT = await ethers.getContractFactory('RentToken')
		const Cafe = await ethers.getContractFactory('CafeMock')
		const SP = await ethers.getContractFactory('StealableProperties')
		const PA = await ethers.getContractFactory('PropertyAuction')
		const Properties = await ethers.getContractFactory('Properties')

		rent = await RENT.deploy()
		cafe = await Cafe.deploy()
		properties = await Properties.deploy('')
		sp = await SP.deploy(cafe.address, properties.address, '')
		pa = await PA.deploy(sp.address, rent.address)

		await properties.grantRole(keccak256('MINTER_ROLE'), sp.address)
	})

	describe('add auction', () => {
		it('reverts without any items', async () => {
			const tx = pa.addAuction([], [], [], 0, 0, 0, 0)
			await expect(tx).to.revertedWith(
				'PropertyAuction: needs items to auction'
			)
		})

		it('reverts with different ids and counts lengths', async () => {
			let tx = pa.addAuction([1], [1], [], 0, 0, 0, 0)
			await expect(tx).to.revertedWith(
				'PropertyAuction: ids, counts and weights length mismatch'
			)

			tx = pa.addAuction([1], [], [1], 0, 0, 0, 0)
			await expect(tx).to.revertedWith(
				'PropertyAuction: ids, counts and weights length mismatch'
			)

			tx = pa.addAuction([1], [], [], 0, 0, 0, 0)
			await expect(tx).to.revertedWith(
				'PropertyAuction: ids, counts and weights length mismatch'
			)
		})

		it('reverts with count = 0', async () => {
			await sp.create(1, 1, [], 0, 0, 0, 0, 0, 0, 0, 0)
			await sp.create(2, 1, [], 0, 0, 0, 0, 0, 0, 0, 0)
			const tx = pa.addAuction([1, 2], [1, 0], [1, 2], 0, 0, 0, 0)
			await expect(tx).to.revertedWith(
				'PropertyAuction: all counts must be > 0'
			)
		})

		it('reverts with weight = 0', async () => {
			await sp.create(1, 1, [], 0, 0, 0, 0, 0, 0, 0, 0)
			await sp.create(2, 1, [], 0, 0, 0, 0, 0, 0, 0, 0)
			const tx = pa.addAuction([1, 2], [1, 2], [0, 2], 0, 0, 0, 0)
			await expect(tx).to.revertedWith('DutchAuction: all weights must be > 0')
		})

		it('reverts if a property does not exist', async () => {
			await sp.create(1, 1, [], 0, 0, 0, 0, 0, 0, 0, 0)
			const tx = pa.addAuction([1, 2], [1, 1], [1, 1], 0, 0, 0, 0)
			await expect(tx).to.revertedWith(
				'PropertyAuction: all properties need to exist'
			)
		})

		it('works with right inputs', async () => {
			await Promise.all([
				sp.create(1, 1, [], 0, 0, 0, 0, 0, 0, 0, 0),
				sp.create(2, 1, [], 0, 0, 0, 0, 0, 0, 0, 0),
			])

			const tx = await pa.addAuction([1, 2], [3, 2], [5, 8], 1, 2, 3, 4)
			expect(cleanOutput(await pa.getAuction(0))).to.deep.equal([
				{
					ids: [1n, 2n],
					counts: [3n, 2n],
					weights: [5n, 8n],
					startPrice: 1n,
					endPrice: 2n,
					duration: 3n,
					startTimestamp: 4n,
					done: false,
					totalWeights: 13n,
				},
				[],
			])
			await expect(tx)
				.to.emit(pa, 'AuctionAdded')
				.withArgs(0, [1, 2], [3, 2], [5, 8], 1, 2, 3, 4)
		})
	})

	describe('set cuts', () => {
		it('can set cuts', async () => {
			// TODO: await expect(tx).to.emit(pa, 'CutsSet').withArgs(...)
			let tx = pa.setCuts([])
			await expect(tx).to.not.be.reverted
			await expect(tx).to.emit(pa, 'CutsSet')

			tx = pa.setCuts([[ethers.constants.AddressZero, 10000n]])
			await expect(tx).to.not.be.reverted
			await expect(tx).to.emit(pa, 'CutsSet')
		})

		it('cannot set cuts > 1e4', async () => {
			await expect(
				pa.setCuts([[ethers.constants.AddressZero, 10001n]])
			).to.revertedWith('PropertyAuction: sum of cut amounts too high')

			await expect(
				pa.setCuts([
					[ethers.constants.AddressZero, 9000n],
					[ethers.constants.AddressZero, 1001n],
				])
			).to.revertedWith('PropertyAuction: sum of cut amounts too high')
		})
	})

	describe('confirm auction', () => {
		it('works with valid state', async () => {
			await sp.grantRole(keccak256('MINTER_ROLE'), pa.address)
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(pa.address, 200)
			await Promise.all([
				sp.create(1, 4, [], 0, 0, 0, 0, 0, 0, 0, 0),
				sp.create(2, 6, [], 0, 0, 0, 0, 0, 0, 0, 0),
			])

			const { timestamp } = await ethers.provider.getBlock()
			const start = timestamp + 100

			await evm.setNextBlockTimestamp(timestamp + 1)
			await pa.addAuction([1, 2], [4, 6], [3, 2], 300, 100, 1000, start)

			await evm.setNextBlockTimestamp(start + 500)
			await evm.mine()

			const tx = await pa.connect(alice).buy(0, 200)
			await expect(tx)
				.to.emit(sp, 'TransferSingle')
				.withArgs(
					pa.address,
					ethers.constants.AddressZero,
					alice.address,
					1n,
					4n
				)
			await expect(tx)
				.to.emit(sp, 'TransferSingle')
				.withArgs(
					pa.address,
					ethers.constants.AddressZero,
					alice.address,
					2n,
					6n
				)

			await expect(tx)
				.to.emit(sp, 'PropertyMinted')
				.withArgs(alice.address, 1n, 4n, 30n)
			await expect(tx)
				.to.emit(sp, 'PropertyMinted')
				.withArgs(alice.address, 2n, 6n, 13n)
		})

		it('cannot win an auction twice', async () => {
			await sp.grantRole(keccak256('MINTER_ROLE'), pa.address)
			await rent.mint(alice.address, 2500)
			await rent.connect(alice).approve(pa.address, 2500)
			await sp.create(1, 4, [], 0, 0, 0, 0, 0, 0, 1000, 0)
			await pa.addAuction([1], [1], [1], 250, 250, 0, 0)

			await pa.connect(alice).buy(0, 250)
			await expect(pa.connect(alice).buy(0, 250)).to.be.revertedWith(
				'PropertyAuction: auction already won'
			)
		})

		it('distributes the right cuts', async () => {
			let tx

			await sp.grantRole(keccak256('MINTER_ROLE'), pa.address)
			await rent.mint(alice.address, 2500)
			await rent.connect(alice).approve(pa.address, 2500)
			await sp.create(1, 4, [], 0, 0, 0, 0, 0, 0, 1000, 0)
			await pa.addAuction([1], [1], [1], 250, 250, 0, 0)
			await pa.addAuction([1], [1], [1], 1000, 1000, 0, 0)
			await pa.addAuction([1], [1], [1], 1000, 1000, 0, 0)

			tx = await pa.connect(alice).buy(0, 250)
			await expect(tx)
				.to.emit(sp, 'TransferSingle')
				.withArgs(
					pa.address,
					ethers.constants.AddressZero,
					alice.address,
					1n,
					1n
				)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, ethers.constants.AddressZero, 250n)

			await pa.setCuts([
				[bob.address, 1000],
				[carol.address, 4000],
			])

			tx = await pa.connect(alice).buy(1, 1000)
			await expect(tx)
				.to.emit(sp, 'TransferSingle')
				.withArgs(
					pa.address,
					ethers.constants.AddressZero,
					alice.address,
					1n,
					1n
				)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, ethers.constants.AddressZero, 500n)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, bob.address, 100n)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, carol.address, 400n)

			await pa.setCuts([[bob.address, 4000]])

			tx = await pa.connect(alice).buy(2, 1000)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, ethers.constants.AddressZero, 600n)
			await expect(tx)
				.to.emit(rent, 'Transfer')
				.withArgs(alice.address, bob.address, 400n)
		})
	})

	describe('roles', () => {
		it('cannot set cut if not manager', async () => {
			const tx = pa
				.connect(alice)
				.setCuts([[ethers.constants.AddressZero, 10000n]])
			await expectRevertWithRole(tx, alice.address, 'MANAGER_ROLE')
		})

		it('cannot mint if PropertyAuction does not have the minter role', async () => {
			// Create property and auction
			await sp.create(1, 1, [], 0, 0, 0, 0, 0, 0, 0, 0)
			await pa.addAuction([1], [3], [1], 1, 2, 3, 4)

			// Give RENT and approve
			await rent.mint(alice.address, 200)
			await rent.connect(alice).approve(pa.address, 200)

			// Try to buy
			const tx = pa.connect(alice).buy(0, 100)
			await expectRevertWithRole(tx, pa.address, 'MINTER_ROLE')
		})
	})
})
