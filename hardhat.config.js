module.exports = {
	solidity: {
		version: '0.8.9',
		settings: {
			optimizer: {
				enabled: true,
				runs: 200,
				details: {
					yul: true,
					yulDetails: {
						stackAllocation: true,
					},
				},
			},
		},
	},
	networks: {
		hardhat: {
			initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
			blockGasLimit: 8_000_000,
			chainId: 43114,
		},
		ropsten: {
			url: process.env.ROPSTEN_URL || '',
			accounts:
				process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
		},
	},
	gasReporter: {
		enabled: process.env.REPORT_GAS !== undefined,
		currency: 'USD',
		gasPrice: 1_000,
	},
	etherscan: {
		apiKey: process.env.ETHERSCAN_API_KEY,
	},
}
