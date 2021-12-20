const { expect } = require('chai')
const { ethers } = require('hardhat')
const abiCoder = ethers.utils.defaultAbiCoder

// Lib
const { cleanOutput, keccak256, expectRevertWithRole } = require('./lib/tools')

describe('StealableProperties', async () => {
	let owner, alice, bob, carol
	let cafe, properties, sp, stealer
	let owners, details

	const create = async (
		id,
		cap,
		poolIds,
		multiplier,
		bonus,
		protection,
		stealMints = 0
	) => {
		const tx = await sp.create(
			id,
			cap,
			poolIds,
			multiplier,
			bonus,
			protection,
			0,
			0,
			0,
			0,
			stealMints
		)
		await tx.wait()

		details[id] = {
			id,
			cap,
			minted: 0n,
			poolIds,
			multiplier,
			bonus,
			protection,
			startRatio: 0n,
			endRatio: 0n,
			duration: 0n,
			keepRatio: 0n,
			stealMints: BigInt(stealMints),
			stealMintsDone: 0n,
		}
	}

	const mint = async (id, { address }, count, price = 0) => {
		const tx = await sp.mint(address, id, count, price, [])
		await tx.wait()
		details[id].minted += BigInt(count)
		return tx
	}

	const checkMinted = async (id) => {
		const properties = cleanOutput(await sp.getProperty(id))
		return expect(properties).to.deep.include(details[id])
	}

	const checkBalance = async (id, { address }, count) => {
		return expect(await sp.balanceOf(address, id)).to.equal(count)
	}

	const checkUpstreamBalance = async (id, { address }, count) => {
		return expect(await properties.balanceOf(address, id)).to.equal(count)
	}

	const getOrderedOwners = async (id) => {
		const owners = []
		const index = Number(cleanOutput(await sp.getProperty(id)).index)
		const circularOwners = cleanOutput(await sp.getOwners(id))

		for (let i = 0; i < circularOwners.length; i++) {
			owners.push(circularOwners[(index + i) % circularOwners.length])
		}

		return owners
	}

	const checkOwnersDetailed = async (id, expected) => {
		const owners = await getOrderedOwners(id)
		return expect(owners).to.deep.equal(expected)
	}

	const checkOwners = async (id, expected) => {
		const owners = await getOrderedOwners(id)
		return expect(owners.map(({ user }) => user)).to.deep.equal(
			expected.map(({ address }) => address)
		)
	}

	const expectOwner = async (id) => {
		return checkOwnersDetailed(id, owners[id])
	}

	const checkOwner = async (
		id,
		{ address },
		{ blockNumber },
		price,
		count = 1
	) => {
		if (!owners[id]) {
			owners[id] = []
		}

		const { timestamp } = await ethers.provider.getBlock(blockNumber)

		for (let i = 0; i < count; i++) {
			owners[id].push({ user: address, since: BigInt(timestamp), price })
		}

		await expectOwner(id)
	}

	beforeEach(async () => {
		;[owner, alice, bob, carol] = await ethers.getSigners()

		const Cafe = await ethers.getContractFactory('CafeMock')
		const SP = await ethers.getContractFactory('StealableProperties')
		const Stealer = await ethers.getContractFactory('StealerMock')
		const Properties = await ethers.getContractFactory('Properties')

		cafe = await Cafe.deploy()
		properties = await Properties.deploy('')
		sp = await SP.deploy(cafe.address, properties.address, '')
		stealer = await Stealer.deploy(sp.address)

		await Promise.all([
			sp.grantRole(keccak256('STEALER_ROLE'), stealer.address),
			properties.grantRole(keccak256('MINTER_ROLE'), sp.address),
		])

		owners = {}
		details = {}
	})

	describe('create', () => {
		it('can create a token', async () => {
			await cafe.setPools([1, 2])
			const tx = await sp.create(0, 3, [1, 2], 2, 10, 5, 1, 2, 3, 4, 5)

			await expect(tx)
				.to.emit(sp, 'PropertyCreated')
				.withArgs(0, 3, [1, 2], 2, 10, 5, 1, 2, 3, 4, 5)

			expect(cleanOutput(await sp.getProperty(0))).to.deep.equal({
				id: 0n,
				cap: 3n,
				minted: 0n,
				poolIds: [1n, 2n],
				multiplier: 2n,
				bonus: 10n,
				protection: 5n,
				index: 0n,
				startRatio: 1n,
				endRatio: 2n,
				duration: 3n,
				keepRatio: 4n,
				stealMints: 5n,
				stealMintsDone: 0n,
			})
		})

		it('cannot create a token with a 0 cap', async () => {
			const tx = sp.create(0, 0, [], 2, 10, 5, 0, 0, 0, 0, 0)
			await expect(tx).to.be.revertedWith(
				'StealableProperties: cap must be > 0'
			)
		})

		it('cannot create an existing token', async () => {
			await (await sp.create(0, 3, [], 2, 10, 5, 0, 0, 0, 0, 0)).wait()
			const tx = sp.create(0, 3, [], 2, 10, 5, 0, 0, 0, 0, 0)
			await expect(tx).to.be.revertedWith(
				'StealableProperties: property with given id already exists'
			)
		})

		it('cannot create a token with inexistant pools', async () => {
			await cafe.setPools([1])
			const tx = sp.create(0, 3, [1, 2], 2, 10, 5, 0, 0, 0, 0, 0)
			await expect(tx).to.be.revertedWith(
				'StealableProperties: Cafe needs to have all pools'
			)
		})
	})

	describe('mint', () => {
		beforeEach(async () => {
			await create(0n, 4n, [], 2n, 10n, 5n)
		})

		it('can mint tokens', async () => {
			let mintTx

			// Alice
			mintTx = await mint(0, alice, 1, 1)
			await checkBalance(0, alice, 1n)
			await checkMinted(0, 1n)
			await checkOwner(0, alice, mintTx, 1n)
			await checkUpstreamBalance(0, alice, 1n)

			mintTx = await mint(0, alice, 1, 2)
			await checkBalance(0, alice, 2n)
			await checkMinted(0, 2n)
			await checkOwner(0, alice, mintTx, 2n)
			await checkUpstreamBalance(0, alice, 2n)

			// Bob
			mintTx = await mint(0, bob, 2, 3)
			await checkBalance(0, bob, 2n)
			await checkMinted(0, 4n)
			await checkOwner(0, bob, mintTx, 3n, 2)
			await checkUpstreamBalance(0, bob, 2n)
		})

		it('cannot mint a new token above the cap', async () => {
			await expect(sp.mint(alice.address, 0, 5, 0, [])).to.be.revertedWith(
				'StealableProperties: additional amount must not exceed cap'
			)

			await (await sp.mint(alice.address, 0, 4, 0, [])).wait()
			await expect(sp.mint(alice.address, 0, 1, 0, [])).to.be.revertedWith(
				'StealableProperties: additional amount must not exceed cap'
			)
		})

		it('cannot mint an inexistant token', async () => {
			await expect(sp.mint(alice.address, 1, 1, 0, [])).to.be.revertedWith(
				'StealableProperties: additional amount must not exceed cap'
			)
		})
	})

	describe('transfer', async () => {
		beforeEach(async () => {
			await create(0n, 4n, [], 2n, 10n, 0n)
		})

		it('only updates owners on transfer', async () => {
			let mintTx, transferTx

			// Alice
			mintTx = await mint(0, alice, 1, 1)
			await checkOwner(0, alice, mintTx, 1n)

			// Bob
			mintTx = await mint(0, bob, 2, 2)
			await checkOwner(0, bob, mintTx, 2n, 2)

			// Alice
			mintTx = await mint(0, alice, 1, 3)
			await checkOwner(0, alice, mintTx, 3n)

			// Transfer from Alice to Carol
			transferTx = await sp
				.connect(alice)
				.safeTransferFrom(alice.address, carol.address, 0, 1, [])
			await transferTx.wait()
			owners[0][0].user = carol.address
			await expectOwner(0)

			// Transfer from Bob to Carol
			transferTx = await sp
				.connect(bob)
				.safeTransferFrom(bob.address, carol.address, 0, 2, [])
			await transferTx.wait()
			owners[0][1].user = carol.address
			owners[0][2].user = carol.address
			await expectOwner(0)

			// Transfer from Carol to Alice
			transferTx = await sp
				.connect(carol)
				.safeTransferFrom(carol.address, alice.address, 0, 2, [])
			await transferTx.wait()
			owners[0][0].user = alice.address
			owners[0][1].user = alice.address
			await expectOwner(0)
		})

		it('reverts when the user does not own enough tokens', async () => {
			const transferTx = sp
				.connect(alice)
				.safeTransferFrom(alice.address, carol.address, 0, 1, [])

			await expect(transferTx).to.be.revertedWith(
				'StealableProperties: owner not found on transfer'
			)
		})

		it('sends an event on transfer', async () => {
			const mintTx = await mint(0, alice, 1)

			// From
			await expect(mintTx)
				.to.emit(cafe, 'UpdateUserAllPools')
				.withArgs(
					ethers.constants.AddressZero,
					abiCoder.encode(['int256', 'int256'], [-2, -10])
				)

			// To
			await expect(mintTx)
				.to.emit(cafe, 'UpdateUserAllPools')
				.withArgs(alice.address, abiCoder.encode(['int256', 'int256'], [2, 10]))
		})
	})

	describe('steal', async () => {
		beforeEach(async () => {
			await cafe.setPools([0, 1])
			await create(0n, 4n, [], 2000n, 10n, 0n, 50n)
			await create(1n, 4n, [0, 1], 2000n, 10n, 10n, 50n)
		})

		it('can steal from oneself', async () => {
			const mintTx = await mint(0, alice, 1, 1)
			await checkOwner(0, alice, mintTx, 1n)
			await checkUpstreamBalance(0, alice, 1n)

			const tx = await stealer.connect(alice).stealPrice(0, 5)
			const { blockNumber } = tx
			const { timestamp } = await ethers.provider.getBlock(blockNumber)

			owners[0][0].since = BigInt(timestamp)
			owners[0][0].price = 5n

			await expectOwner(0)
			await checkUpstreamBalance(0, alice, 2n)
			await expect(tx)
				.to.emit(sp, 'PropertyStolen')
				.withArgs(0, alice.address, alice.address, 5n, true)
		})

		it('can steal a property when cap is reached', async () => {
			let mintTx

			// Alice
			mintTx = await mint(0, alice, 1, 1)
			await checkOwner(0, alice, mintTx, 1n)

			// Bob
			mintTx = await mint(0, bob, 2, 2)
			await checkOwner(0, bob, mintTx, 2n, 2)

			// Alice
			mintTx = await mint(0, alice, 1, 3)
			await checkOwner(0, alice, mintTx, 3n)

			// Initial upstream state
			await checkUpstreamBalance(0, alice, 2n)
			await checkUpstreamBalance(0, bob, 2n)

			const order = [carol, alice, carol, bob, bob]
			const balances = {
				[alice.address]: 2,
				[bob.address]: 2,
				[carol.address]: 0,
			}
			const upstreamBalances = {
				[alice.address]: 2,
				[bob.address]: 2,
				[carol.address]: 0,
			}

			for (const [i, user] of order.entries()) {
				const index = i % Number(details[0].minted)
				const stealTx = await (
					await stealer.connect(user).stealPrice(0, i)
				).wait()

				balances[owners[0][0].user]--
				balances[user.address]++
				upstreamBalances[user.address]++

				for (const address of [owners[0][index].user, user.address]) {
					await checkBalance(0, { address }, balances[address])
					await checkUpstreamBalance(0, { address }, upstreamBalances[address])
				}

				const { blockNumber } = stealTx
				const { timestamp } = await ethers.provider.getBlock(blockNumber)

				owners[0].shift()
				owners[0].push({
					user: user.address,
					since: BigInt(timestamp),
					price: BigInt(i),
				})

				await expectOwner(0)
			}
		})

		it('cannot steal a protected property', async () => {
			let tx

			// Mined in block 56
			const { blockNumber } = await mint(1, alice, 1)
			await mint(1, bob, 1)

			// At block 57
			tx = stealer.connect(carol).steal(1)
			await expect(tx).to.be.revertedWith(
				'StealableProperties: property still protected'
			)

			// At block 58
			// Mine 6 blocks
			const currentBlock = await ethers.provider.getBlockNumber()
			for (let i = 0; i < blockNumber + 8 - currentBlock; i++) {
				await ethers.provider.send('evm_mine')
			}

			// Sanity check
			expect(await ethers.provider.getBlockNumber()).to.equal(blockNumber + 8)

			// Mined in block 65
			tx = stealer.connect(carol).steal(1)
			await expect(tx).to.be.revertedWith(
				'StealableProperties: property still protected'
			)

			// Sanity check
			expect(await ethers.provider.getBlockNumber()).to.equal(blockNumber + 9)

			// Mined in block 66
			await stealer.connect(carol).steal(1)
		})

		it('cannot steal a property with 0 mints', async () => {
			const tx = stealer.connect(carol).steal(1)
			await expect(tx).to.be.revertedWith(
				'StealableProperties: property not available for stealing'
			)
		})
	})

	describe('pause', () => {
		it('can be paused', async () => {
			await expect(sp.pause()).to.emit(sp, 'Paused').withArgs(owner.address)
			expect(await sp.paused()).to.equal(true)
		})

		it('can be unpaused', async () => {
			await sp.pause()
			await expect(sp.unpause()).to.emit(sp, 'Unpaused').withArgs(owner.address)
			expect(await sp.paused()).to.equal(false)
		})

		it('cannot mint while paused', async () => {
			await create(0n, 4n, [], 2n, 10n, 0n)
			await sp.pause()
			await expect(sp.mint(alice.address, 0, 1, 0, [])).to.be.revertedWith(
				'ERC1155Pausable: token transfer while paused'
			)
		})

		it('other accounts cannot pause', async () => {
			await expect(sp.connect(alice).pause()).to.be.reverted
		})

		it('other accounts cannot unpause', async () => {
			await sp.pause()
			await expect(sp.connect(alice).unpause()).to.be.reverted
		})

		it('cannot steal while paused', async () => {
			await create(0n, 4n, [], 2n, 10n, 0n)
			await mint(0, alice, 1)
			await sp.pause()
			await expect(stealer.connect(bob).steal(0)).to.be.revertedWith(
				'ERC1155Pausable: token transfer while paused'
			)
		})
	})

	describe('interface', () => {
		it('supports the ERC1155 interface', async () => {
			expect(await sp.supportsInterface('0xd9b67a26')).to.equal(true)
		})

		it('supports the AccessControl interface', async () => {
			expect(await sp.supportsInterface('0x7965db0b')).to.equal(true)
		})

		it('supports the AccessControlEnumerable interface', async () => {
			expect(await sp.supportsInterface('0x5a05180f')).to.equal(true)
		})
	})

	describe('mint + steal', () => {
		it('can mint new properties when some have been stolen already', async () => {
			await create(0n, 10n, [], 2n, 10n, 0n)
			await mint(0, alice, 1)
			await mint(0, bob, 1)
			await checkOwners(0, [alice, bob])

			await stealer.connect(carol).steal(0)
			await checkOwners(0, [bob, carol])

			await mint(0, alice, 1)
			await checkOwners(0, [bob, carol, alice])

			await stealer.connect(bob).steal(0)
			await checkOwners(0, [carol, alice, bob])

			await mint(0, alice, 2)
			await checkOwners(0, [carol, alice, bob, alice, alice])
		})
	})

	describe('upstream mints', () => {
		it('does not mint over stealMints for steals', async () => {
			const stealMints = 3
			await create(0n, 10n, [], 2n, 10n, 0n, stealMints)
			await mint(0, alice, 1)
			await checkUpstreamBalance(0, alice, 1)

			for (let i = 0; i < 5; i++) {
				await stealer.connect(carol).steal(0)
				await checkUpstreamBalance(0, carol, Math.min(stealMints, i + 1))
			}
		})

		it('reaches cap + stealMints on upstream', async () => {
			const stealMints = 3
			await create(0n, 5n, [], 2n, 10n, 0n, stealMints)
			await mint(0, alice, 2)
			await mint(0, carol, 3)
			await checkUpstreamBalance(0, alice, 2)
			await checkUpstreamBalance(0, carol, 3)

			for (let i = 0; i < 5; i++) {
				await stealer.connect(bob).steal(0)
				await checkUpstreamBalance(0, bob, Math.min(stealMints, i + 1))
			}

			// Sum of balances is 8 = 5 (cap) + 3 (stealMints)
			await checkUpstreamBalance(0, alice, 2)
			await checkUpstreamBalance(0, bob, 3)
			await checkUpstreamBalance(0, carol, 3)
		})
	})

	describe('uri', () => {
		it('can change URI', async () => {
			const tx = sp.setURI('http://newUri')
			await expect(tx).to.emit(sp, 'SetURI').withArgs('http://newUri')
			expect(await sp.uri(0)).to.equal('http://newUri')
		})
	})

	describe('roles', () => {
		it('cannot call create without creator role', async () => {
			await expectRevertWithRole(
				sp.connect(bob).create(0, 3, [], 2, 10, 5, 1, 2, 3, 4, 5),
				bob.address,
				'CREATOR_ROLE'
			)
		})

		it('cannot call mint without minter role', async () => {
			await expectRevertWithRole(
				sp.connect(bob).mint(ethers.constants.AddressZero, 0, 0, 0, []),
				bob.address,
				'MINTER_ROLE'
			)
		})

		it('cannot call pause without pauser role', async () => {
			await expectRevertWithRole(
				sp.connect(bob).pause(),
				bob.address,
				'PAUSER_ROLE'
			)
		})

		it('cannot call unpause without pauser role', async () => {
			await expectRevertWithRole(
				sp.connect(bob).unpause(),
				bob.address,
				'PAUSER_ROLE'
			)
		})

		it('cannot call steal without stealer role', async () => {
			const Stealer = await ethers.getContractFactory('StealerMock')
			const stealer = await Stealer.deploy(sp.address)
			await expectRevertWithRole(
				stealer.connect(bob).steal(0),
				stealer.address,
				'STEALER_ROLE'
			)
		})

		it('cannot change URI without manager role', async () => {
			await expectRevertWithRole(
				properties.connect(bob).setURI('test'),
				bob.address,
				'MANAGER_ROLE'
			)
		})
	})
})
