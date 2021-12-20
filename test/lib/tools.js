const { BigNumber, utils } = require('ethers')
const { expect } = require('chai')

const toBigInt = (value) => BigInt(BigNumber.from(value).toString())

const cleanOutput = (object) => {
	const keys = new Set(Object.keys([...object]))
	const isBasicArray = keys.size === Object.keys(object).length
	const result = isBasicArray ? [...object] : { ...object }

	for (const [key, value] of Object.entries(result)) {
		if (!isBasicArray && keys.has(key)) {
			delete result[key]
		} else if (BigNumber.isBigNumber(value)) {
			result[key] = toBigInt(value)
		} else if (Array.isArray(value)) {
			result[key] = cleanOutput(value)
		}
	}

	return result
}

const keccak256 = (string) => {
	return utils.keccak256(utils.toUtf8Bytes(string))
}

const expectRevertWithRole = async (tx, address, role) => {
	return expect(tx).to.revertedWith(
		`AccessControl: account ${address.toLowerCase()} is missing role ${keccak256(
			role
		)}`
	)
}

module.exports = {
	cleanOutput,
	keccak256,
	expectRevertWithRole,
	toBigInt,
}
