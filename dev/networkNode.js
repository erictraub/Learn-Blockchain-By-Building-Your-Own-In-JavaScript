const express = require('express')
const app = express()
const Blockchain = require('./blockchain')
const { v1: uuid } = require('uuid')
const port = process.argv[2]
const axios = require('axios').default

const nodeAddress = uuid().split('-').join('')

const bitcoin = new Blockchain()

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// get entire blockchain
app.get('/blockchain', function (req, res) {
  return res.send(bitcoin)
})

// create a new transaction
app.post('/transaction', function (req, res) {
  const newTransaction = req.body
  const blockIndex = bitcoin.addTransactionToPendingTransactions(newTransaction)
  return res.json({ note: `Transaction will be added in block ${blockIndex}.` })
})

// broadcast transaction
app.post('/transaction/broadcast', function (req, res) {
  const newTransaction = bitcoin.createNewTransaction(
    req.body.amount,
    req.body.sender,
    req.body.recipient,
  )
  bitcoin.addTransactionToPendingTransactions(newTransaction)

  const requestPromises = []
  bitcoin.networkNodes.forEach(networkNodeUrl => {
    const requestOptions = {
      url: networkNodeUrl + '/transaction',
      method: 'POST',
      data: newTransaction,
    }
    requestPromises.push(axios(requestOptions))
  })

  Promise.all(requestPromises).then(data => {
    return res.json({ note: 'Transaction created and broadcast successfully.' })
  })
})

// mine a block
app.get('/mine', function (req, res) {
  const lastBlock = bitcoin.getLastBlock()
  const previousBlockHash = lastBlock['hash']
  const currentBlockData = {
    transactions: bitcoin.pendingTransactions,
    index: lastBlock['index'] + 1,
  }
  const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData)
  const blockHash = bitcoin.hashBlock(
    previousBlockHash,
    currentBlockData,
    nonce,
  )
  const newBlock = bitcoin.createNewBlock(nonce, previousBlockHash, blockHash)

  const requestPromises = []
  bitcoin.networkNodes.forEach(networkNodeUrl => {
    const requestOptions = {
      url: networkNodeUrl + '/receive-new-block',
      method: 'POST',
      data: { newBlock: newBlock },
    }

    requestPromises.push(axios(requestOptions))
  })

  Promise.all(requestPromises)
    .then(data => {
      const requestOptions = {
        url: bitcoin.currentNodeUrl + '/transaction/broadcast',
        method: 'POST',
        data: {
          amount: 12.5,
          sender: '00',
          recipient: nodeAddress,
        },
      }

      return axios(requestOptions)
    })
    .then(data => {
      return res.json({
        note: 'New block mined & broadcast successfully',
        block: newBlock,
      })
    })
})

// receive new block
app.post('/receive-new-block', function (req, res) {
  const newBlock = req.body.newBlock
  const lastBlock = bitcoin.getLastBlock()
  const correctHash = lastBlock.hash === newBlock.previousBlockHash
  const correctIndex = lastBlock['index'] + 1 === newBlock['index']

  if (correctHash && correctIndex) {
    bitcoin.chain.push(newBlock)
    bitcoin.pendingTransactions = []
    return res.json({
      note: 'New block received and accepted.',
      newBlock: newBlock,
    })
  } else {
    return res.json({
      note: 'New block rejected.',
      newBlock: newBlock,
    })
  }
})

// register a node and broadcast it the network
app.post('/register-and-broadcast-node', function (req, res) {
  const newNodeUrl = req.body.newNodeUrl
  if (bitcoin.networkNodes.indexOf(newNodeUrl) == -1)
    bitcoin.networkNodes.push(newNodeUrl)

  const regNodesPromises = []
  bitcoin.networkNodes.forEach(networkNodeUrl => {
    const requestOptions = {
      url: networkNodeUrl + '/register-node',
      method: 'POST',
      data: { newNodeUrl: newNodeUrl },
    }

    regNodesPromises.push(axios(requestOptions))
  })

  Promise.all(regNodesPromises)
    .then(data => {
      const bulkRegisterOptions = {
        url: newNodeUrl + '/register-nodes-bulk',
        method: 'POST',
        data: {
          allNetworkNodes: [...bitcoin.networkNodes, bitcoin.currentNodeUrl],
        },
      }

      return axios(bulkRegisterOptions)
    })
    .then(data => {
      return res.json({
        note: 'New node registered with network successfully.',
      })
    })
})

// register a node with the network
app.post('/register-node', function (req, res) {
  const newNodeUrl = req.body.newNodeUrl
  const nodeNotAlreadyPresent = bitcoin.networkNodes.indexOf(newNodeUrl) == -1
  const notCurrentNode = bitcoin.currentNodeUrl !== newNodeUrl
  if (nodeNotAlreadyPresent && notCurrentNode)
    bitcoin.networkNodes.push(newNodeUrl)
  return res.json({ note: 'New node registered successfully.' })
})

// register multiple nodes at once
app.post('/register-nodes-bulk', function (req, res) {
  const allNetworkNodes = req.body.allNetworkNodes
  allNetworkNodes.forEach(networkNodeUrl => {
    const nodeNotAlreadyPresent =
      bitcoin.networkNodes.indexOf(networkNodeUrl) == -1
    const notCurrentNode = bitcoin.currentNodeUrl !== networkNodeUrl
    if (nodeNotAlreadyPresent && notCurrentNode)
      bitcoin.networkNodes.push(networkNodeUrl)
  })

  return res.json({ note: 'Bulk registration successful.' })
})

// consensus
app.get('/consensus', function (req, res) {
  const requestPromises = []
  bitcoin.networkNodes.forEach(networkNodeUrl => {
    const requestOptions = {
      url: networkNodeUrl + '/blockchain',
      method: 'GET',
    }

    requestPromises.push(axios(requestOptions))
  })

  Promise.all(requestPromises).then(blockchains => {
    const currentChainLength = bitcoin.chain.length
    let maxChainLength = currentChainLength
    let newLongestChain = null
    let newPendingTransactions = null

    blockchains.forEach(blockchain => {
      if (blockchain.chain.length > maxChainLength) {
        maxChainLength = blockchain.chain.length
        newLongestChain = blockchain.chain
        newPendingTransactions = blockchain.pendingTransactions
      }
    })

    if (
      !newLongestChain ||
      (newLongestChain && !bitcoin.chainIsValid(newLongestChain))
    ) {
      return res.json({
        note: 'Current chain has not been replaced.',
        chain: bitcoin.chain,
      })
    } else {
      bitcoin.chain = newLongestChain
      bitcoin.pendingTransactions = newPendingTransactions
      return res.json({
        note: 'This chain has been replaced.',
        chain: bitcoin.chain,
      })
    }
  })
})

// get block by blockHash
app.get('/block/:blockHash', function (req, res) {
  const blockHash = req.params.blockHash
  const correctBlock = bitcoin.getBlock(blockHash)
  return res.json({
    block: correctBlock,
  })
})

// get transaction by transactionId
app.get('/transaction/:transactionId', function (req, res) {
  const transactionId = req.params.transactionId
  const trasactionData = bitcoin.getTransaction(transactionId)
  return res.json({
    transaction: trasactionData.transaction,
    block: trasactionData.block,
  })
})

// get address by address
app.get('/address/:address', function (req, res) {
  const address = req.params.address
  const addressData = bitcoin.getAddressData(address)
  return res.json({
    addressData: addressData,
  })
})

// block explorer
app.get('/block-explorer', function (req, res) {
  return res.sendFile('./block-explorer/index.html', { root: __dirname })
})

app.listen(port, function () {
  console.log(`Listening on port ${port}...`)
})
