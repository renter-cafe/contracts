module.exports = (ethers) => ({
	async getBlock(block) {
		return ethers.provider.getBlock(block)
	},

	async latestBlockNumber() {
		return ethers.provider.getBlockNumber()
	},

	async mine() {
		return ethers.provider.send('evm_mine', [])
	},

	async increaseTime(duration) {
		return ethers.provider.send('evm_increaseTime', [duration])
	},

	async setNextBlockTimestamp(timestamp) {
		return ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
	},

	async mineTo(target) {
		target = BigInt(target)

		const currentBlock = await this.latestBlockNumber()
		if (target < currentBlock) {
			throw Error(
				`Target block #(${target}) is lower than current block #(${currentBlock})`
			)
		}

		while ((await this.latestBlockNumber()) < target) {
			await this.mine()
		}
	},

	async snapshot() {
		this.lastSnapshot = await ethers.provider.send('evm_snapshot', [])
		return this.lastSnapshot
	},

	async revert(snapshot) {
		return ethers.provider.send('evm_revert', [snapshot || this.lastSnapshot])
	},

	async setAutomine(automine) {
		return ethers.provider.send('evm_setAutomine', [automine])
	},
})
