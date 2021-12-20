const { expect } = require('chai')
const { ethers } = require('hardhat')
const abiCoder = ethers.utils.defaultAbiCoder

const { keccak256, expectRevertWithRole } = require('./lib/tools')

describe('Rewarder', async () => {
	let alice, bob, carol, dan
	let rewarder, rt

	const updateBalance = async (user, balance) => {
		return rt.updateUserBalance(0, user.address, balance)
	}

	const updateUserPool = async (user, data, pool = 0) => {
		return rt.updateUserPool(
			pool,
			user.address,
			ethers.constants.AddressZero,
			abiCoder.encode(['int256', 'int256'], data)
		)
	}

	const updateUserAllPools = async (user, data) => {
		return rt.updateUserAllPools(
			user.address,
			ethers.constants.AddressZero,
			abiCoder.encode(['int256', 'int256'], data)
		)
	}

	beforeEach(async () => {
		;[, alice, bob, carol, dan] = await ethers.getSigners()

		const Rewarder = await ethers.getContractFactory('Rewarder')
		const RT = await ethers.getContractFactory('RewarderTester')

		rewarder = await Rewarder.deploy()
		rt = await RT.deploy(rewarder.address)

		await rewarder.grantRole(keccak256('USER_UPDATER_ROLE'), rt.address)
	})

	it('can update balances', async () => {
		const balances = [5, 10, 100]
		for (const balance of balances) {
			const tx = updateBalance(alice, balance)
			await expect(tx).to.emit(rt, 'Total').withArgs(balance)
			await expect(tx)
				.to.emit(rewarder, 'UserBalanceUpdated')
				.withArgs(0, alice.address, balance)
		}
	})

	it('calculates correct totals for bonus', async () => {
		let total = 0n
		for (const bonus of [5, 10, -8, -7, 2]) {
			total += BigInt(bonus)
			const tx = updateUserPool(alice, [0, bonus])
			await expect(tx).to.emit(rt, 'Total').withArgs(total)
			await expect(tx)
				.to.emit(rewarder, 'UserPoolUpdated')
				.withArgs(0, alice.address, 0, total)
		}
	})

	it('calculates correct totals for pool multiplier', async () => {
		const multipliers = [0.0001, 0.01, 1, -1, -0.01, -0.0001]
		const users = [
			{
				balance: 1,
				user: alice,
			},
			{
				balance: 10,
				user: bob,
			},
			{
				balance: 1e4,
				user: carol,
			},
			{
				balance: 10 ** 12,
				user: dan,
			},
		]

		for (const { user, balance } of users) {
			let totalMultiplier = 0
			await updateBalance(user, balance)

			for (const multiplier of multipliers) {
				totalMultiplier += multiplier
				const tx = updateUserPool(user, [multiplier * 1e4, 0])
				await expect(tx)
					.to.emit(rt, 'Total')
					.withArgs(BigInt(Math.floor(balance * (1 + totalMultiplier))))
				await expect(tx)
					.to.emit(rewarder, 'UserPoolUpdated')
					.withArgs(0, user.address, Math.round(totalMultiplier * 1e4), 0)
			}
		}
	})

	it('calculates correct totals for global multipliers', async () => {
		const multipliers = [0.0001, 0.01, 1, -1, -0.01, -0.0001]
		const users = [
			{
				balance: 1,
				user: alice,
			},
			{
				balance: 10,
				user: bob,
			},
			{
				balance: 1e4,
				user: carol,
			},
			{
				balance: 10 ** 12,
				user: dan,
			},
		]

		for (const { user, balance } of users) {
			let totalMultiplier = 0
			await updateBalance(user, balance)

			for (const multiplier of multipliers) {
				totalMultiplier += multiplier
				const tx = updateUserAllPools(user, [multiplier * 1e4, 0])
				await expect(tx).to.emit(rt, 'UpdateResult').withArgs(false, 1)
				await expect(tx)
					.to.emit(rt, 'PoolTotal')
					.withArgs(0, BigInt(Math.floor(balance * (1 + totalMultiplier))))
				await expect(tx)
					.to.emit(rewarder, 'UserAllPoolsUpdated')
					.withArgs(user.address, Math.round(totalMultiplier * 1e4), 0)
			}
		}
	})

	it('calculates correct totals for mixed', async () => {
		const tests = [
			{
				user: alice,
				balance: 100,
				bonus: 10,
				multiplier: 0.1,
				total: 121,
			},
			{
				user: bob,
				balance: 100000,
				bonus: 100,
				multiplier: 0.0001,
				total: 100110,
			},
			{
				user: carol,
				balance: 0,
				bonus: 1000,
				multiplier: 0.01,
				total: 1010,
			},
			{
				user: dan,
				balance: 100000000,
				bonus: 0,
				multiplier: 0.0000999,
				total: 100000000,
			},
		]

		let tx
		for (const test of tests) {
			tx = await updateUserPool(test.user, [
				Math.floor(test.multiplier * 1e4),
				test.bonus,
			])
			await expect(tx)
				.to.emit(rewarder, 'UserPoolUpdated')
				.withArgs(
					0,
					test.user.address,
					Math.floor(test.multiplier * 1e4),
					test.bonus
				)

			tx = updateBalance(test.user, test.balance)
			await expect(tx).to.emit(rt, 'Total').withArgs(BigInt(test.total))
			await expect(tx)
				.to.emit(rewarder, 'UserBalanceUpdated')
				.withArgs(0, test.user.address, test.balance)
		}
	})

	it('calculates correct totals for a complex scenario', async () => {
		let tx

		// Add a global property with 100 multiplier and 10 bonus
		tx = updateUserAllPools(alice, [100, 0])
		await expect(tx).to.emit(rt, 'UpdateResult').withArgs(false, 0)
		expect(await rt.getTotal(alice.address, 0)).to.equal(0)

		// Add 90 LPs to pool 0
		tx = updateBalance(alice, 100, 0)
		await expect(tx).to.emit(rt, 'Total').withArgs(101)

		// Add a second global property with 100 multiplier and 0 bonus
		tx = updateUserAllPools(alice, [100, 0])
		await expect(tx).to.emit(rt, 'UpdateResult').withArgs(false, 1)
		await expect(tx).to.emit(rt, 'PoolTotal').withArgs(0, 102)
		expect(await rt.getTotal(alice.address, 0)).to.equal(102)

		// Add a property for pool 1 with 100 multiplier and 90 bonus
		tx = updateUserPool(alice, [500, 200], 1)
		await expect(tx).to.emit(rt, 'Total').withArgs(214)
		expect(await rt.getTotal(alice.address, 1)).to.equal(214)

		// Add a third global property with 100 multiplier and 0 bonus
		// Note that in this case, pool 2 doesn't have a balance but a total
		tx = updateUserAllPools(alice, [100, 0])
		await expect(tx).to.emit(rt, 'UpdateResult').withArgs(false, 2)
		await expect(tx).to.emit(rt, 'PoolTotal').withArgs(0, 103)
		await expect(tx).to.emit(rt, 'PoolTotal').withArgs(1, 216)
		expect(await rt.getTotal(alice.address, 0)).to.equal(103)
		expect(await rt.getTotal(alice.address, 1)).to.equal(216)

		// Add a fourth global property with 0 multiplier and 100 bonus
		tx = updateUserAllPools(alice, [0, 100])
		await expect(tx).to.emit(rt, 'UpdateResult').withArgs(true, 0)
		expect(await rt.getTotal(alice.address, 0)).to.equal(206)
		expect(await rt.getTotal(alice.address, 1)).to.equal(324)

		// At this point, UpdateResult should always has updateAll = true
		tx = updateUserAllPools(alice, [0, 0])
		await expect(tx).to.emit(rt, 'UpdateResult').withArgs(true, 0)

		// Remove the global bonus
		tx = updateUserAllPools(alice, [0, -100])
		await expect(tx).to.emit(rt, 'UpdateResult').withArgs(true, 0)

		// Should not return updateAll = true anymore
		tx = updateUserAllPools(alice, [100, 0])
		await expect(tx).to.emit(rt, 'UpdateResult').withArgs(false, 2)
	})

	describe('roles', () => {
		it('cannot call updateUserPool without user updater role', async () => {
			await expectRevertWithRole(
				rewarder
					.connect(bob)
					.updateUserPool(
						0,
						ethers.constants.AddressZero,
						ethers.constants.AddressZero,
						[]
					),
				bob.address,
				'USER_UPDATER_ROLE'
			)
		})

		it('cannot call updateUserAllPools without user updater role', async () => {
			await expectRevertWithRole(
				rewarder
					.connect(bob)
					.updateUserAllPools(
						ethers.constants.AddressZero,
						ethers.constants.AddressZero,
						[]
					),
				bob.address,
				'USER_UPDATER_ROLE'
			)
		})

		it('cannot call updateUserBalance without user updater role', async () => {
			await expectRevertWithRole(
				rewarder
					.connect(bob)
					.updateUserBalance(0, ethers.constants.AddressZero, 0),
				bob.address,
				'USER_UPDATER_ROLE'
			)
		})
	})
})
