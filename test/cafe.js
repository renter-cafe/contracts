const { expect } = require('chai')
const { ethers } = require('hardhat')

const Evm = require('./lib/evm')
const {
	cleanOutput,
	keccak256,
	toBigInt,
	expectRevertWithRole,
} = require('./lib/tools')

describe('Cafe', async () => {
	let alice, bob, carol, dan, dev, minter, fee
	let RentToken, Cafe, ERC20Mock, Rewarder, SP, Stealer, Properties
	let cafe, rent, rewarder
	let lp, lp2

	const evm = Evm(ethers)

	const deployCafe = async (
		rentPerSecond,
		startTimestamp,
		bonusEndTimestamp
	) => {
		rent = await RentToken.deploy()
		rewarder = await Rewarder.deploy()
		cafe = await Cafe.deploy(
			rent.address,
			rewarder.address,
			dev.address,
			fee.address,
			rentPerSecond,
			startTimestamp,
			bonusEndTimestamp
		)
		await rewarder.grantRole(keccak256('USER_UPDATER_ROLE'), cafe.address)
	}

	const newLp = async () =>
		await ERC20Mock.deploy('LPToken', 'LP', 10000000000n)

	before(async () => {
		;[alice, bob, carol, dan, dev, minter, fee] = await ethers.getSigners()

		// Contracts
		Rewarder = await ethers.getContractFactory('Rewarder')
		RentToken = await ethers.getContractFactory('RentToken', dev)
		Cafe = await ethers.getContractFactory('Cafe', dev)
		ERC20Mock = await ethers.getContractFactory('ERC20Mock', minter)
		SP = await ethers.getContractFactory('StealableProperties')
		Properties = await ethers.getContractFactory('Properties')
		Stealer = await ethers.getContractFactory('StealerMock')
	})

	describe('state', () => {
		it('sets correct state variables', async () => {
			await deployCafe(1000, 10, 10000)
			await rent.transferOwnership(cafe.address)

			expect(await rent.owner()).to.equal(cafe.address)
			expect(await cafe.rent()).to.equal(rent.address)
			expect(await cafe.rewarder()).to.equal(rewarder.address)
			expect(await cafe.devAddress()).to.equal(dev.address)
			expect(await cafe.rentPerSecond()).to.equal(1000)
			expect(await cafe.startTimestamp()).to.equal(10)
			expect(await cafe.bonusEndTimestamp()).to.equal(10000)
			expect(await cafe.BONUS_MULTIPLIER()).to.equal(10)
		})

		it('can change the dev address', async () => {
			await deployCafe(1000, 0, 1000)
			expect(await cafe.devAddress()).to.equal(dev.address)

			const tx = await cafe.setDevAddress(bob.address)
			expect(await cafe.devAddress()).to.equal(bob.address)
			await expect(tx).to.emit(cafe, 'SetDevAddress').withArgs(bob.address)
		})

		it('can not change the dev address if not dev', async () => {
			await deployCafe(1000, 0, 1000)
			await expect(
				cafe.connect(alice).setDevAddress(bob.address)
			).to.be.revertedWith('Cafe: must be dev')
		})

		it('has correct roles', async () => {
			const roles = ['USER_UPDATER_ROLE', 'POOL_MANAGER_ROLE']

			await deployCafe(1000, 0, 1000)

			for (const role of roles) {
				expect(await cafe[role]()).to.equal(keccak256(role))
			}
		})

		it('can update the RENT per second', async () => {
			await deployCafe(1234, 0, 1000)
			await cafe.grantRole(keccak256('MANAGER_ROLE'), alice.address)
			expect(await cafe.rentPerSecond()).to.equal(1234)

			const tx = await cafe.connect(alice).setRentPerSecond(5678)
			expect(await cafe.rentPerSecond()).to.equal(5678)
			await expect(tx).to.emit(cafe, 'SetRentPerSecond').withArgs(5678)
		})
	})

	describe('pools', () => {
		it('can add a pool', async () => {
			await deployCafe(1000, 0, 1000)

			const lps = await Promise.all([newLp(), newLp()])
			let tx = await cafe.addPool(100, lps[0].address, 0)

			expect(await cafe.poolLength()).to.equal(1)
			await expect(tx)
				.to.emit(cafe, 'AddPool')
				.withArgs(0, lps[0].address, 100, 0)

			await cafe.addPool(200, (await newLp()).address, 1)
			tx = await cafe.addPool(300, lps[1].address, 2)

			expect(await cafe.poolLength()).to.equal(3)
			const { timestamp } = await evm.getBlock(tx.blockNumber)
			await expect(tx)
				.to.emit(cafe, 'AddPool')
				.withArgs(2, lps[1].address, 300, 2)
			await expect(tx)
				.to.emit(cafe, 'UpdatePool')
				.withArgs(0, timestamp, 0, 0, 0)
			await expect(tx)
				.to.emit(cafe, 'UpdatePool')
				.withArgs(1, timestamp, 0, 0, 0)
		})

		it('cannot add duplicate pools', async () => {
			const lp = await newLp()
			await deployCafe(1000, 0, 1000)
			await cafe.addPool(100, lp.address, 0)
			await expect(cafe.addPool(100, lp.address, 0)).to.revertedWith(
				'Cafe: token already added'
			)
		})

		it('can patch a pool', async () => {
			const lp = await newLp()

			// Deply Cafe
			await deployCafe(1000, 0, 1000)
			await rent.transferOwnership(cafe.address)

			// Add LP
			const add = await cafe.addPool(100, lp.address, 0)
			const pool = {
				token: lp.address,
				allocation: 100n,
				lastRewardTimestamp: BigInt(
					(await evm.getBlock(add.blockNumber)).timestamp
				),
				balance: 0n,
			}

			// Check initial state
			expect(cleanOutput(await cafe.pools(0))).to.deep.include(pool)

			// Approve balance and deposit
			await lp.transfer(bob.address, 1000)
			await lp.connect(bob).approve(cafe.address, 1000)
			const deposit = await cafe.connect(bob).deposit(0, 100)

			// Check events
			await expect(deposit)
				.to.emit(cafe, 'UpdateUserTotal')
				.withArgs(bob.address, 0, 100n, 0n)
			await expect(deposit).to.emit(cafe, 'UpdatePoolTotal').withArgs(0, 100n)

			// Check state with added balance
			expect(cleanOutput(await cafe.pools(0))).to.deep.include({
				...pool,
				balance: 100n,
				lastRewardTimestamp: BigInt(
					(await evm.getBlock(deposit.blockNumber)).timestamp
				),
			})

			// Patch the pool
			const patch = await cafe.patchPool(0, 50, 2)
			const { timestamp } = await evm.getBlock(patch.blockNumber)
			expect(cleanOutput(await cafe.pools(0))).to.deep.include({
				...pool,
				balance: 100n,
				allocation: 50n,
				lastRewardTimestamp: BigInt(
					(await evm.getBlock(patch.blockNumber)).timestamp
				),
				withdrawFee: 2,
			})
			await expect(patch).to.emit(cafe, 'PatchPool').withArgs(0, 50, 2)
			await expect(patch)
				.to.emit(cafe, 'UpdatePool')
				.withArgs(0, timestamp, 100n, 100n, 10000000000000n)
		})
	})

	describe('basic', () => {
		// Give alice, bob and carol 1000 of both LP tokens
		beforeEach(async () => {
			const accounts = [alice, bob, carol]
			;[lp, lp2] = await Promise.all([
				ERC20Mock.deploy('LPToken', 'LP', 10000000000n),
				ERC20Mock.deploy('LPToken2', 'LP2', 10000000000n),
			])

			await Promise.all(
				accounts
					.map((user) => [
						lp.transfer(user.address, 1000),
						lp2.transfer(user.address, 1000),
					])
					.flat()
			)
		})

		it('gives out RENTs only after farming time', async () => {
			let tx
			const start = (await evm.getBlock()).timestamp + 15

			// Setup contract, pool and approve
			// 100 per block farming rate starting at block 100 with bonus until block 1000
			await deployCafe(100, start, start + 100)
			await rent.transferOwnership(cafe.address)
			await cafe.addPool(100, lp.address, 0)
			await lp.connect(bob).approve(cafe.address, 1000)

			// Approve and deposit
			tx = await cafe.connect(bob).deposit(0, 100)
			await evm.setNextBlockTimestamp(start - 1)
			await expect(tx)
				.to.emit(cafe, 'UpdateUserTotal')
				.withArgs(bob.address, 0, 100, 0)
			await expect(tx).to.emit(cafe, 'UpdatePoolTotal').withArgs(0, 100n)

			// Check at block 28
			tx = await cafe.connect(bob).deposit(0, 0)
			expect(await rent.balanceOf(bob.address)).to.equal(0)
			await expect(tx)
				.to.emit(cafe, 'UpdateUserTotal')
				.withArgs(bob.address, 0, 100, 0)
			await expect(tx).to.emit(cafe, 'UpdatePoolTotal').withArgs(0, 100n)

			// Check at block 29
			await evm.setNextBlockTimestamp(start)
			await cafe.connect(bob).harvest(0)
			expect(await rent.balanceOf(bob.address)).to.equal(0)

			// Check at block 30 where it should have rewarded 1000 RENT
			await evm.setNextBlockTimestamp(start + 1)
			await cafe.connect(bob).deposit(0, 0)
			expect(await rent.balanceOf(bob.address)).to.equal(1000)

			// Mine 5 more blocks in total and check balances
			await evm.setNextBlockTimestamp(start + 5)
			await cafe.connect(bob).deposit(0, 0)
			expect(await rent.balanceOf(bob.address)).to.equal(5000)
			expect(await rent.balanceOf(dev.address)).to.equal(500)
			expect(await rent.totalSupply()).to.equal(5500)
		})

		it('does not distribute RENTs if no one withdraws', async () => {
			const start = (await evm.getBlock()).timestamp + 15

			// Setup contract, pool and approve
			// 100 per block farming rate starting at block 200 with bonus until block 1000
			await deployCafe(100, start, start + 100)
			await rent.transferOwnership(cafe.address)
			await cafe.addPool(100, lp.address, 0)
			await lp.connect(bob).approve(cafe.address, 1000)

			// Make sure the supply doesn't go up before start block
			await evm.setNextBlockTimestamp(start)
			await evm.mine()
			expect(await rent.totalSupply()).to.equal(0)

			// Make sure the supply doesn't go up when there's no liquidity
			await evm.setNextBlockTimestamp(start + 5)
			await evm.mine()
			expect(await rent.totalSupply()).to.equal(0)

			// Deposit 10 LPs at block 210
			await evm.setNextBlockTimestamp(start + 10)
			await cafe.connect(bob).deposit(0, 10)
			expect(await rent.totalSupply()).to.equal(0)
			expect(await rent.balanceOf(bob.address)).to.equal(0)
			expect(await rent.balanceOf(dev.address)).to.equal(0)
			expect(await lp.balanceOf(bob.address)).to.equal(990)

			// Mine 10 more blocks and withdraw all LPs
			await evm.setNextBlockTimestamp(start + 20)
			const tx = await cafe.connect(bob).withdraw(0, 10)
			expect(await rent.totalSupply()).to.equal(11000)
			expect(await rent.balanceOf(bob.address)).to.equal(10000)
			expect(await rent.balanceOf(dev.address)).to.equal(1000)
			expect(await lp.balanceOf(bob.address)).to.equal(1000)
			await expect(tx)
				.to.emit(cafe, 'UpdateUserTotal')
				.withArgs(bob.address, 0, 0, 0)
			await expect(tx).to.emit(cafe, 'UpdatePoolTotal').withArgs(0, 0)
		})

		it('distributes RENTs properly for each staker', async () => {
			const start = (await evm.getBlock()).timestamp + 15

			// Setup contract, pool
			// 100 per block farming rate starting at block 300 with bonus until block 1000
			await deployCafe(100, start, start + 100)
			await rent.transferOwnership(cafe.address)
			await cafe.addPool(100, lp.address, 0)

			// Approve all accounts
			await Promise.all([
				lp.connect(alice).approve(cafe.address, 1000),
				lp.connect(bob).approve(cafe.address, 1000),
				lp.connect(carol).approve(cafe.address, 1000),
			])

			// Alice deposits 10 LPs at block 310
			await evm.setNextBlockTimestamp(start + 10)
			await cafe.connect(alice).deposit(0, 10)

			// Bob deposits 20 LPs at block 314
			await evm.setNextBlockTimestamp(start + 14)
			await cafe.connect(bob).deposit(0, 20)

			// Carol deposits 30 LPs at block 318
			await evm.setNextBlockTimestamp(start + 18)
			await cafe.connect(carol).deposit(0, 30)

			// Alice deposits 10 more LPs at block 320. At this point:
			//   Alice should have: 4*1000 + 4*1/3*1000 + 2*1/6*1000 = 5666
			//   Cafe should have the remaining: 10000 - 5666 = 4334
			await evm.setNextBlockTimestamp(start + 20)
			await cafe.connect(alice).deposit(0, 10)
			expect(await rent.totalSupply()).to.equal(11000)
			expect(await rent.balanceOf(alice.address)).to.equal(5666)
			expect(await rent.balanceOf(bob.address)).to.equal(0)
			expect(await rent.balanceOf(carol.address)).to.equal(0)
			expect(await rent.balanceOf(cafe.address)).to.equal(4334)
			expect(await rent.balanceOf(dev.address)).to.equal(1000)

			// Bob withdraws 5 LPs at block 330. At this point:
			//   Bob should have: 4*2/3*1000 + 2*2/6*1000 + 10*2/7*1000 = 6190
			await evm.setNextBlockTimestamp(start + 30)
			await cafe.connect(bob).withdraw(0, 5)
			expect(await rent.totalSupply()).to.equal(22000)
			expect(await rent.balanceOf(alice.address)).to.equal(5666)
			expect(await rent.balanceOf(bob.address)).to.equal(6190)
			expect(await rent.balanceOf(carol.address)).to.equal(0)
			expect(await rent.balanceOf(cafe.address)).to.equal(8144)
			expect(await rent.balanceOf(dev.address)).to.equal(2000)

			// Alice withdraws 20 LPs at block 340.
			// Bob withdraws 15 LPs at block 350.
			// Carol withdraws 30 LPs at block 360.
			await evm.setNextBlockTimestamp(start + 40)
			await cafe.connect(alice).withdraw(0, 20)
			await evm.setNextBlockTimestamp(start + 50)
			await cafe.connect(bob).withdraw(0, 15)
			await evm.setNextBlockTimestamp(start + 60)
			await cafe.connect(carol).withdraw(0, 30)
			expect(await rent.totalSupply()).to.equal(55000)
			expect(await rent.balanceOf(dev.address)).to.equal(5000)

			// Alice should have: 5666 + 10*2/7*1000 + 10*2/6.5*1000 = 11600
			expect(await rent.balanceOf(alice.address)).to.equal(11600)

			// Bob should have: 6190 + 10*1.5/6.5 * 1000 + 10*1.5/4.5*1000 = 11831
			expect(await rent.balanceOf(bob.address)).to.equal(11831)

			// Carol should have: 2*3/6*1000 + 10*3/7*1000 + 10*3/6.5*1000 + 10*3/4.5*1000 + 10*1000 = 26568
			expect(await rent.balanceOf(carol.address)).to.equal(26568)

			// All of them should have 1000 LPs back.
			expect(await lp.balanceOf(alice.address)).to.equal(1000)
			expect(await lp.balanceOf(bob.address)).to.equal(1000)
			expect(await lp.balanceOf(carol.address)).to.equal(1000)
		})

		it('gives proper RENTs allocation to each pool', async () => {
			const start = (await evm.getBlock()).timestamp + 15

			// Setup contract, pool and approve
			// 100 per block farming rate starting at block 400 with bonus until block 1000
			await deployCafe(100, start, start + 100)
			await rent.transferOwnership(cafe.address)
			await Promise.all([
				lp.connect(alice).approve(cafe.address, 1000),
				lp2.connect(bob).approve(cafe.address, 1000),
			])

			// Add first LP to the pool with allocation 1
			await cafe.addPool(10, lp.address, 0)

			// Alice deposits 10 LPs at block 410
			await evm.setNextBlockTimestamp(start + 10)
			await cafe.connect(alice).deposit(0, 10)

			// Add LP2 to the pool with allocation 2 at block 420
			await evm.setNextBlockTimestamp(start + 20)
			await cafe.addPool(20, lp2.address, 0)

			// Alice should have 10*1000 pending reward
			expect(await cafe.pendingRent(0, alice.address)).to.equal(10000)

			// Bob deposits 10 LP2s at block 425
			await evm.setNextBlockTimestamp(start + 25)
			await cafe.connect(bob).deposit(1, 5)

			// Alice should have 10000 + 5*1/3*1000 = 11666 pending reward
			expect(await cafe.pendingRent(0, alice.address)).to.equal(11666)
			await evm.setNextBlockTimestamp(start + 30)
			await evm.mine()

			// At block 430. Bob should get 5*2/3*1000 = 3333. Alice should get ~1666 more.
			expect(await cafe.pendingRent(0, alice.address)).to.equal(13333)
			expect(await cafe.pendingRent(1, bob.address)).to.equal(3333)
		})

		it('stops giving bonus RENTs after the bonus period ends', async () => {
			const start = (await evm.getBlock()).timestamp + 15

			// 100 per block farming rate starting at block 500 with bonus until block 600
			await deployCafe(100, start, start + 100)
			await rent.transferOwnership(cafe.address)
			await lp.connect(alice).approve(cafe.address, 1000)
			await cafe.addPool(1, lp.address, 0)

			// Alice deposits 10 LPs at block 590
			await evm.setNextBlockTimestamp(start + 90)
			await cafe.connect(alice).deposit(0, 10)

			// At block 605, she should have 1000*10 + 100*5 = 10500 pending.
			await evm.setNextBlockTimestamp(start + 105)
			await evm.mine()
			await expect(await cafe.pendingRent(0, alice.address)).to.equal(10500)

			// At block 606, Alice harvests all pending rewards and should get 10600.
			const tx = await cafe.connect(alice).harvest(0)
			expect(await cafe.pendingRent(0, alice.address)).to.equal(0)
			expect(await rent.balanceOf(alice.address)).to.equal(10600)
			await expect(tx)
				.to.emit(cafe, 'Harvest')
				.withArgs(alice.address, 0, 10600)
			await expect(tx).to.emit(cafe, 'UpdateUserTotal')

			// At block 616, Alice should have 10 * 100 more RENT
			await evm.setNextBlockTimestamp(start + 116)
			await evm.mine()
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1000)
			expect(await rent.balanceOf(alice.address)).to.equal(10600)
		})

		it('cannot withdraw more than balance', async () => {
			await deployCafe(100, 50, 1000)
			await rent.transferOwnership(cafe.address)
			await cafe.addPool(100, lp.address, 0)
			await lp.connect(bob).approve(cafe.address, 1000)
			await cafe.connect(bob).deposit(0, 100)

			await expect(cafe.connect(bob).withdraw(0, 101)).to.revertedWith(
				'Cafe: balance too low'
			)

			await expect(cafe.connect(bob).withdraw(0, 100)).to.not.be.reverted
		})
	})

	describe('minting', () => {
		beforeEach(async () => {
			// Deploy Cafe
			await deployCafe(100, 0, 9999999999999n)

			// Transfer ownership to the cafe
			await rent.transferOwnership(cafe.address)

			// Add LPs
			await cafe.addPool(1, lp.address, 0)
		})

		it('has the right pending balance', async () => {
			// Approve LPs
			await Promise.all([
				lp.connect(alice).approve(cafe.address, 10),
				lp.connect(bob).approve(cafe.address, 10),
			])

			// Deposit LPs
			await Promise.all([
				cafe.connect(alice).deposit(0, 10),
				cafe.connect(bob).deposit(0, 10),
			])

			await evm.mine()

			// First block minted alone, second block with both alice and bob
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1500n)
		})

		it('harvests the right amount of RENT and resets pending balance', async () => {
			// Approve LPs
			await lp.connect(alice).approve(cafe.address, 10)

			// Deposit LPs
			await cafe.connect(alice).deposit(0, 10)

			// Check the pending balance
			expect(await rent.balanceOf(alice.address)).to.equal(0)
			expect(await cafe.pendingRent(0, alice.address)).to.equal(0)

			// Harvest
			const tx = await cafe.connect(alice).harvest(0)
			await expect(tx).to.emit(cafe, 'Harvest').withArgs(alice.address, 0, 1000)

			// Check balance and pending balance
			expect(await rent.balanceOf(alice.address)).to.equal(1000)
			expect(await cafe.pendingRent(0, alice.address)).to.equal(0)
		})

		it('harvests nothing if there is nothing to harvest', async () => {
			const tx = await cafe.connect(alice).harvest(0)
			await expect(tx).to.emit(cafe, 'Harvest').withArgs(alice.address, 0, 0)
		})

		it('mints right RENT with multiple providers', async () => {
			// Approve LPs
			await Promise.all([
				lp.connect(alice).approve(cafe.address, 10),
				lp.connect(bob).approve(cafe.address, 10),
				lp.connect(carol).approve(cafe.address, 10),
			])

			// Alice deposit
			await cafe.connect(alice).deposit(0, 10)
			expect(await cafe.pendingRent(0, alice.address)).to.equal(0n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(0n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(0n)

			// Bob deposit
			await cafe.connect(bob).deposit(0, 10)
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1000n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(0n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(0n)

			// Carol deposit
			await cafe.connect(carol).deposit(0, 10)
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1500n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(500n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(0n)

			// Next block
			await evm.mine()
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1833n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(833n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(333n)
		})
	})

	describe('properties', () => {
		let lps, sp, stealer, properties

		// Give alice, bob and carol 1000 of both LP tokens
		beforeEach(async () => {
			// Deploy Cafe and StealableProperties
			await deployCafe(100, 0, 9999999999999n)

			properties = await Properties.deploy('')
			sp = await SP.deploy(cafe.address, properties.address, '')
			stealer = await Stealer.deploy(sp.address)

			// Grant roles
			await cafe.grantRole(keccak256('USER_UPDATER_ROLE'), sp.address)
			await sp.grantRole(keccak256('STEALER_ROLE'), stealer.address)
			await properties.grantRole(keccak256('MINTER_ROLE'), sp.address)

			// Transfer ownership to the cafe
			await rent.transferOwnership(cafe.address)

			// Add LPs
			lps = await Promise.all([
				ERC20Mock.connect(minter).deploy('LPToken', 'LP', 10000000000n),
			])
			await Promise.all(lps.map((lp) => cafe.addPool(1, lp.address, 0)))

			// Mint LPs for a few accounts
			await Promise.all([
				lps[0].transfer(alice.address, 100),
				lps[0].transfer(bob.address, 100),
				lps[0].transfer(carol.address, 100),
			])
		})

		it('mints more RENT for property owners', async () => {
			// Create and mint property
			await sp.create(0, 1, [0], 90000, 0, 0, 0, 0, 0, 0, 0)
			await sp.mint(dan.address, 0, 1, 0, [])

			// Approve LPs
			await Promise.all([
				lps[0].connect(alice).approve(cafe.address, 10),
				lps[0].connect(bob).approve(cafe.address, 10),
			])

			// Deposit LPs
			await cafe.connect(alice).deposit(0, 10)
			await cafe.connect(bob).deposit(0, 10)

			// Buy property for alice
			await stealer.connect(alice).steal(0)
			await evm.mine()

			// First block minted alone, second block with both alice and bob
			// Last block minted with a 10x property
			expect(await cafe.pendingRent(0, alice.address)).to.equal(909)

			// Mine on more block
			await evm.mine()

			// The user still has 10 / 11 shares
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1818)
		})

		it('mints right RENT when property was lost', async () => {
			// Create and mint property
			await sp.create(0, 2, [], 20000, 0, 0, 0, 0, 0, 0, 0)
			await sp.mint(dan.address, 0, 2, 0, [])

			// Approve LPs
			await Promise.all([
				lps[0].connect(alice).approve(cafe.address, 10),
				lps[0].connect(bob).approve(cafe.address, 10),
				lps[0].connect(carol).approve(cafe.address, 10),
			])

			// Deposit LPs
			await cafe.connect(alice).deposit(0, 10)
			await cafe.connect(bob).deposit(0, 10)
			await cafe.connect(carol).deposit(0, 10)

			// Current state
			await evm.snapshot()
			await evm.mine()
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1833n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(833n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(333n)
			await evm.revert()

			// Buy property for alice
			await stealer.connect(alice).steal(0)

			// With the first house, alice has 60% shares (600 RENT / block), both others have 20% each (200 RENT per block)
			// The starting balance is 100 RENT
			await evm.snapshot()
			await evm.mine()
			expect(await cafe.pendingRent(0, alice.address)).to.equal(600n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(833n + 200n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(333n + 200n)
			expect(await rent.balanceOf(alice.address)).to.equal(1833n)
			expect(await rent.balanceOf(bob.address)).to.equal(0n)
			expect(await rent.balanceOf(carol.address)).to.equal(0n)
			await evm.revert()

			// Mine on more block
			await stealer.connect(bob).steal(0)

			// Now alice and bob have 3/7 shares (429 RENT / block) and carol has 1/7 (143 RENT per block)
			await evm.snapshot()
			await evm.mine()
			expect(await cafe.pendingRent(0, alice.address)).to.equal(1029n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(429n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(533n + 143n)
			expect(await rent.balanceOf(alice.address)).to.equal(1833n)
			expect(await rent.balanceOf(bob.address)).to.equal(1033n)
			expect(await rent.balanceOf(carol.address)).to.equal(0n)
			await evm.revert()

			// Mine on more block
			await stealer.connect(carol).steal(0)

			// Now bob and carol have 3/7 shares (429 RENT / block) and alice has 1/7 (143 RENT per block)
			// Alice lost her house and was thus auto-harvested
			await evm.mine()
			expect(await cafe.pendingRent(0, alice.address)).to.equal(143n)
			expect(await cafe.pendingRent(0, bob.address)).to.equal(429n + 429n)
			expect(await cafe.pendingRent(0, carol.address)).to.equal(429n)
			expect(await rent.balanceOf(alice.address)).to.equal(1833n + 1029n)
			expect(await rent.balanceOf(bob.address)).to.equal(1033n)
			expect(await rent.balanceOf(carol.address)).to.equal(676n)
		})

		it('mints right RENT for per-pool NFTs', async () => {
			let promises

			const checkPending = async (users) => {
				const results = {}
				for (const [address, balances] of Object.entries(users)) {
					const result = await Promise.all(
						[...balances.entries()].map(async ([i]) =>
							cafe.pendingRent(i, address)
						)
					)
					results[address] = result.map(toBigInt)
				}
				expect(results).to.deep.equal(users)
			}

			const checkBalance = async (users) => {
				const results = {}
				for (const address of Object.keys(users)) {
					results[address] = toBigInt(await rent.balanceOf(address))
				}
				expect(results).to.deep.equal(users)
			}

			// Add 2 pools
			promises = [
				ERC20Mock.connect(minter).deploy('LPToken2', 'LP2', 10000000000n),
				ERC20Mock.connect(minter).deploy('LPToken3', 'LP3', 10000000000n),
			]

			lps = [lps[0], ...(await Promise.all(promises))]
			await Promise.all(
				lps.slice(1).map((lp) => cafe.addPool(1, lp.address, 0))
			)

			// Mint LPs
			promises = [0, 1, 2].flatMap((i) => [
				lps[i].transfer(alice.address, 100),
				lps[i].transfer(bob.address, 100),
			])
			await Promise.all(promises)

			// Approve LPs
			promises = [0, 1, 2].flatMap((i) => [
				lps[i].connect(alice).approve(cafe.address, 10),
				lps[i].connect(bob).approve(cafe.address, 10),
			])

			// Create properties
			await sp.create(0, 3, [1, 2], 10000, 0, 0, 0, 0, 0, 0, 0)
			await sp.create(1, 2, [0], 40000, 0, 0, 0, 0, 0, 0, 0)
			await sp.create(2, 1, [], 90000, 0, 0, 0, 0, 0, 0, 0)
			await sp.create(3, 1, [], 0, 90, 0, 0, 0, 0, 0, 0)

			// Mint properties
			await sp.mint(dan.address, 0, 3, 0, [])
			await sp.mint(dan.address, 1, 2, 0, [])
			await sp.mint(dan.address, 2, 1, 0, [])

			// Disable automine
			await evm.setAutomine(false)

			// Deposit 10 LPs in each pool
			promises = [0, 1, 2].flatMap((i) => [
				cafe.connect(alice).deposit(i, 10, { gasLimit: 300000 }),
				cafe.connect(bob).deposit(i, 10, { gasLimit: 300000 }),
			])
			await Promise.all(promises)

			// Enable automine
			await evm.setAutomine(true)

			// Mine all deposit transactions at the same time
			await evm.mine()
			await checkPending({
				[alice.address]: [0n, 0n, 0n],
				[bob.address]: [0n, 0n, 0n],
			})
			await checkBalance({
				[alice.address]: 0n,
				[bob.address]: 0n,
			})

			// Check output after one block
			// alice: 1/2, 1/2, 1/2 (= 166.5 + 166.5 + 166.5)
			// bob: 1/2, 1/2, 1/2 (= 166.5 + 166.5 + 166.5)
			await evm.mine()
			await checkPending({
				[alice.address]: [166n, 166n, 166n],
				[bob.address]: [166n, 166n, 166n],
			})
			await checkBalance({
				[alice.address]: 0n,
				[bob.address]: 0n,
			})

			// Steal property 0
			// alice: 1/2, 2/3, 2/3 (= 166.5 + 222 + 222)
			// bob: 1/2, 1/3, 1/3 (= 166.5 + 111 + 111)
			await stealer.connect(alice).steal(0)
			await checkPending({
				[alice.address]: [333n, 0n, 0n],
				[bob.address]: [333n, 333n, 333n],
			})
			await checkBalance({
				[alice.address]: 666n,
				[bob.address]: 0n,
			})

			// Mine one block with property 0
			await evm.mine()
			await checkPending({
				[alice.address]: [500n, 222n, 222n],
				[bob.address]: [500n, 444n, 444n],
			})
			await checkBalance({
				[alice.address]: 666n,
				[bob.address]: 0n,
			})

			// Steal property 1
			// alice: 5/6, 2/3, 2/3 (= 277.5 + 222 + 222)
			// bob: 1/6, 1/3, 1/3 (= 55.5 + 111 + 111)
			await stealer.connect(alice).steal(1)
			await checkPending({
				[alice.address]: [0n, 444n, 444n],
				[bob.address]: [666n, 555n, 555n],
			})
			await checkBalance({
				[alice.address]: 1332n,
				[bob.address]: 0n,
			})

			// Mine one block with property 1
			await evm.mine()
			await checkPending({
				[alice.address]: [278n, 666n, 666n],
				[bob.address]: [722n, 666n, 666n],
			})
			await checkBalance({
				[alice.address]: 1332n,
				[bob.address]: 0n,
			})

			// Steal property 2
			// alice: 14/15, 11/12, 11/12 (= 310.8 + 305.25 + 305.25)
			// bob: 1/15, 1/12, 1/12 (= 22.2 + 27.75 + 27.75)
			await stealer.connect(alice).steal(2)
			await checkPending({
				[alice.address]: [0n, 0n, 0n],
				[bob.address]: [777n, 777n, 777n],
			})
			await checkBalance({
				[alice.address]: 3663n,
				[bob.address]: 0n,
			})

			// Mine one block with property 2
			await evm.mine()
			await checkPending({
				[alice.address]: [310n, 305n, 305n],
				[bob.address]: [799n, 805n, 805n],
			})
			await checkBalance({
				[alice.address]: 3663n,
				[bob.address]: 0n,
			})

			// Steal property 3
			// alice: 14/15, 11/12, 11/12 (= 310.8 + 305.25 + 305.25)
			// bob: 1/15, 1/12, 1/12 (= 22.2 + 27.75 + 27.75)
			await sp.mint(alice.address, 3, 1, 0, [])
			await checkPending({
				[alice.address]: [0n, 0n, 0n],
				[bob.address]: [821n, 832n, 832n],
			})
			await checkBalance({
				[alice.address]: 5506n,
				[bob.address]: 0n,
			})

			// Mine one block with property 3
			await evm.mine()
			await checkPending({
				[alice.address]: [330n, 330n, 330n],
				[bob.address]: [824n, 835n, 835n],
			})
			await checkBalance({
				[alice.address]: 5506n,
				[bob.address]: 0n,
			})
		})
	})

	describe('emergency', () => {
		let lp

		beforeEach(async () => {
			// Deploy Cafe and StealableProperties
			await deployCafe(100, 0, 99999999n)

			// Transfer ownership to the cafe
			await rent.transferOwnership(cafe.address)

			// Add LPs
			lp = await ERC20Mock.connect(minter).deploy('LPToken', 'LP', 10000000000n)
			await cafe.addPool(1, lp.address, 0)

			// Mint LPs for a few accounts
			await lp.transfer(alice.address, 10)
		})

		it('can emergency withdraw', async () => {
			// Sanity check
			expect(await lp.balanceOf(alice.address)).to.equal(10)

			// Deposit LPs
			await lp.connect(alice).approve(cafe.address, 10)
			await cafe.connect(alice).deposit(0, 10)
			await evm.mine()
			await evm.mine()

			// Sanity check
			expect(await lp.balanceOf(alice.address)).to.equal(0)

			// Emergency withdraw
			const tx = await cafe.connect(alice).emergencyWithdraw(0)

			// LPs and pending RENT
			expect(await rent.balanceOf(alice.address)).to.equal(0)
			expect(await lp.balanceOf(alice.address)).to.equal(10)
			expect(await cafe.pendingRent(0, alice.address)).to.equal(0)

			// Event
			await expect(tx)
				.to.emit(cafe, 'EmergencyWithdraw')
				.withArgs(alice.address, 0, 10, 0)
			await expect(tx)
				.to.emit(cafe, 'UpdateUserTotal')
				.withArgs(alice.address, 0, 0, 0)
			await expect(tx).to.emit(cafe, 'UpdatePoolTotal').withArgs(0, 0)
		})
	})

	describe('has pools', () => {
		it('returns true if all pools exist', async () => {
			await deployCafe(100, 0, 0)
			await Promise.all(
				Array.from({ length: 4 }).map(async () =>
					cafe.addPool(1, (await newLp()).address, 0)
				)
			)
			expect(await cafe.hasPools([0, 1, 2, 3])).to.equal(true)
			expect(await cafe.hasPools([0])).to.equal(true)
			expect(await cafe.hasPools([0, 3])).to.equal(true)
			expect(await cafe.hasPools([2])).to.equal(true)
		})

		it('returns true false if only some pools exist', async () => {
			await deployCafe(100, 0, 0)
			await cafe.addPool(1, (await newLp()).address, 0)
			await cafe.addPool(1, (await newLp()).address, 0)
			expect(await cafe.hasPools([0, 1, 2, 3])).to.equal(false)
			expect(await cafe.hasPools([1, 3])).to.equal(false)
		})

		it('returns true false if no pool exists', async () => {
			await deployCafe(100, 0, 0)
			await cafe.addPool(1, (await newLp()).address, 0)
			await cafe.addPool(1, (await newLp()).address, 0)
			expect(await cafe.hasPools([2, 3, 4])).to.equal(false)
			expect(await cafe.hasPools([2])).to.equal(false)
		})
	})

	describe('withdraw fee', () => {
		let lps

		beforeEach(async () => {
			await deployCafe(100, 0, 0)
			await rent.transferOwnership(cafe.address)

			lps = await Promise.all([
				ERC20Mock.deploy('LPToken', 'LP', 10000000000n),
				ERC20Mock.deploy('LPToken', 'LP', 10000000000n),
			])
			await Promise.all(lps.map((lp) => lp.transfer(alice.address, 1000)))
			await Promise.all(
				lps.map((lp) => lp.connect(alice).approve(cafe.address, 1000))
			)

			await cafe.addPool(100, lps[0].address, 500)
		})

		it('cannot set withdrawFee > 500', async () => {
			await expect(cafe.addPool(1, lps[1].address, 501)).to.be.revertedWith(
				'Cafe: withdraw fee too high'
			)
			await expect(cafe.patchPool(0, 5, 501)).to.be.revertedWith(
				'Cafe: withdraw fee too high'
			)
		})

		it('can update withdraw fee', async () => {
			const add = await cafe.addPool(100, lps[1].address, 432)
			const pool = {
				token: lps[1].address,
				allocation: 100n,
				lastRewardTimestamp: BigInt(
					(await evm.getBlock(add.blockNumber)).timestamp
				),
				balance: 0n,
				withdrawFee: 432,
			}

			expect(cleanOutput(await cafe.pools(1))).to.deep.include(pool)

			const update = await cafe.patchPool(1, 100n, 123)
			pool.lastRewardTimestamp = BigInt(
				(await evm.getBlock(update.blockNumber)).timestamp
			)
			pool.withdrawFee = 123

			expect(cleanOutput(await cafe.pools(1))).to.deep.include(pool)
		})

		it('keep withdraw fee if withdrawFee > 0', async () => {
			await cafe.connect(alice).deposit(0, 1000)
			const tx = await cafe.connect(alice).withdraw(0, 1000)
			expect(await lps[0].balanceOf(alice.address)).to.equal(950)
			expect(await lps[0].balanceOf(fee.address)).to.equal(50)
			await expect(tx)
				.to.emit(cafe, 'Withdraw')
				.withArgs(alice.address, 0, 1000, 50)
		})

		it('does not keep a fee if withdrawFee = 0', async () => {
			await cafe.connect(alice).deposit(0, 1000)
			await cafe.patchPool(0, 100, 0)
			const tx = await cafe.connect(alice).withdraw(0, 1000)
			expect(await lps[0].balanceOf(alice.address)).to.equal(1000)
			expect(await lps[0].balanceOf(fee.address)).to.equal(0)
			await expect(tx)
				.to.emit(cafe, 'Withdraw')
				.withArgs(alice.address, 0, 1000, 0)
		})

		it('can set the fee address', async () => {
			expect(await cafe.feeAddress()).to.equal(fee.address)
			const tx = await cafe.setFeeAddress(carol.address)
			expect(await cafe.feeAddress()).to.equal(carol.address)
			await expect(tx).to.emit(cafe, 'SetFeeAddress').withArgs(carol.address)
		})

		it('cannot set the fee address to 0x0', async () => {
			await expect(
				cafe.setFeeAddress(ethers.constants.AddressZero)
			).to.be.revertedWith('Cafe: feeAddress must not be the zero address')
		})
	})

	describe('roles', () => {
		before(async () => {
			await deployCafe(1234, 0, 1000)
		})

		it('cannot update the RENT per second without manager role', async () => {
			await expectRevertWithRole(
				cafe.connect(bob).setRentPerSecond(5678),
				bob.address,
				'MANAGER_ROLE'
			)
		})

		it('cannot add a pool without pool manager role', async () => {
			await expectRevertWithRole(
				cafe.connect(bob).addPool(100, ethers.constants.AddressZero, 0),
				bob.address,
				'POOL_MANAGER_ROLE'
			)
		})

		it('cannot update a pool without pool manager role', async () => {
			await expectRevertWithRole(
				cafe.connect(bob).patchPool(0, 1000, 0),
				bob.address,
				'POOL_MANAGER_ROLE'
			)
		})

		it('cannot set the fee address without manager role', async () => {
			await expectRevertWithRole(
				cafe.connect(bob).setFeeAddress(carol.address),
				bob.address,
				'MANAGER_ROLE'
			)
		})

		it('cannot call updateUserPools without user updater role', async () => {
			await expectRevertWithRole(
				cafe
					.connect(bob)
					.updateUserPools(ethers.constants.AddressZero, [1], []),
				bob.address,
				'USER_UPDATER_ROLE'
			)
		})

		it('cannot call updateUserAllPools without user updater role', async () => {
			await expectRevertWithRole(
				cafe.connect(bob).updateUserAllPools(ethers.constants.AddressZero, []),
				bob.address,
				'USER_UPDATER_ROLE'
			)
		})
	})

	describe('harvest', () => {
		let lps

		// Give alice, bob and carol 1000 of both LP tokens
		beforeEach(async () => {
			// Deploy Cafe and StealableProperties
			await deployCafe(100, 0, 9999999999999n)

			// Transfer ownership to the cafe
			await rent.transferOwnership(cafe.address)

			// Add LPs
			lps = await Promise.all([
				ERC20Mock.connect(minter).deploy('LPToken', 'LP', 10000000000n),
				ERC20Mock.connect(minter).deploy('LPToken', 'LP', 10000000000n),
				ERC20Mock.connect(minter).deploy('LPToken', 'LP', 10000000000n),
			])
			await Promise.all(lps.map((lp) => cafe.addPool(1, lp.address, 0)))

			// Mint LPs for Alice
			await Promise.all([
				lps[0].transfer(alice.address, 100),
				lps[1].transfer(alice.address, 100),
				lps[2].transfer(alice.address, 100),
			])

			// Approve tokens
			await Promise.all([
				lps[0].connect(alice).approve(cafe.address, 100),
				lps[1].connect(alice).approve(cafe.address, 100),
				lps[2].connect(alice).approve(cafe.address, 100),
			])
		})

		it('should harvestAll', async () => {
			// Disable automine
			await evm.setAutomine(false)

			// Deposit LPs
			await cafe.connect(alice).deposit(0, 100)
			await cafe.connect(alice).deposit(1, 100)
			await cafe.connect(alice).deposit(2, 100)

			// Mine all deposits in one block
			await evm.mine()
			await evm.setAutomine(true)

			// Harvest all
			await cafe.connect(alice).harvestAll()

			// RENT balance
			expect(await rent.balanceOf(alice.address)).to.equal(999)

			// Pending
			expect(await cafe.pendingRent(0, alice.address)).to.equal(0)
			expect(await cafe.pendingRent(1, alice.address)).to.equal(0)
			expect(await cafe.pendingRent(2, alice.address)).to.equal(0)

			// Pool balance
			expect(cleanOutput(await cafe.users(0, alice.address))).to.deep.equal({
				balance: 100n,
				total: 100n,
				debt: 333n,
			})
			expect(cleanOutput(await cafe.users(1, alice.address))).to.deep.equal({
				balance: 100n,
				total: 100n,
				debt: 333n,
			})
			expect(cleanOutput(await cafe.users(2, alice.address))).to.deep.equal({
				balance: 100n,
				total: 100n,
				debt: 333n,
			})
		})
	})
})
