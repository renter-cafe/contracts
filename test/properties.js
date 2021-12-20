const { expect } = require('chai')
const { ethers } = require('hardhat')

const { expectRevertWithRole } = require('./lib/tools')

describe('Properties', async () => {
	let alice, bob, carol, owner
	let properties

	const checkBalance = async (id, { address }, count) => {
		return expect(await properties.balanceOf(address, id)).to.equal(count)
	}

	beforeEach(async () => {
		;[owner, alice, bob, carol] = await ethers.getSigners()
		const Properties = await ethers.getContractFactory('Properties', owner)
		properties = await Properties.deploy('')
	})

	describe('mint', () => {
		it('can mint', async () => {
			await properties.mint(alice.address, 0, 1, [])
			await checkBalance(0, alice, 1n)

			await properties.mint(bob.address, 0, 1, [])
			await checkBalance(0, bob, 1)

			await properties.mint(bob.address, 0, 2, [])
			await checkBalance(0, bob, 3)

			await properties.mint(bob.address, 1, 2, [])
			await checkBalance(1, bob, 2)

			await properties.mint(carol.address, 2, 999, [])
			await checkBalance(2, carol, 999)
		})

		it('can mint batch', async () => {
			await properties.mintBatch(alice.address, [0], [1], [])
			await checkBalance(0, alice, 1)

			await properties.mintBatch(bob.address, [0, 0, 1], [1, 2, 2], [])
			await checkBalance(0, bob, 3)
			await checkBalance(1, bob, 2)

			await properties.mintBatch(carol.address, [2], [999], [])
			await checkBalance(2, carol, 999)
		})
	})

	describe('uri', () => {
		it('can change URI', async () => {
			const tx = properties.setURI('http://newUri')
			await expect(tx).to.emit(properties, 'SetURI').withArgs('http://newUri')
			expect(await properties.uri(0)).to.equal('http://newUri')
		})
	})

	describe('interface', () => {
		it('supports the ERC1155 interface', async () => {
			expect(await properties.supportsInterface('0xd9b67a26')).to.equal(true)
		})

		it('supports the AccessControl interface', async () => {
			expect(await properties.supportsInterface('0x7965db0b')).to.equal(true)
		})

		it('supports the AccessControlEnumerable interface', async () => {
			expect(await properties.supportsInterface('0x5a05180f')).to.equal(true)
		})
	})

	describe('roles', () => {
		it('cannot mint without minter role', async () => {
			await expectRevertWithRole(
				properties.connect(bob).mint(alice.address, 0, 1, []),
				bob.address,
				'MINTER_ROLE'
			)
		})

		it('cannot batch mint without minter role', async () => {
			await expectRevertWithRole(
				properties.connect(bob).mintBatch(alice.address, [0], [1], []),
				bob.address,
				'MINTER_ROLE'
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
