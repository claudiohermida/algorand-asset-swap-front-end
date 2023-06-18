import { PeraWalletConnect } from '@perawallet/connect'


// PASO 1: Conexion a Pera Wallet
const peraWallet = new PeraWalletConnect();
let accounts: string[] = []

const connectBtn = document.getElementById("connect") as HTMLButtonElement
const accountsList = document.getElementById('accounts') as HTMLSelectElement
const createBtn = document.getElementById("createBtn") as HTMLButtonElement

connectBtn.onclick = async () => {
    accounts = await peraWallet.connect()
    connectBtn.disabled = true
    createBtn.disabled = false
    accounts.forEach(acc => {
        accountsList.add(new Option(acc, acc))
    })
}

// PASO 2: Creacion de app

import algosdk, { AtomicTransactionComposer, AtomicTransactionComposerStatus, Transaction } from 'algosdk'
import * as algokit from '@algorandfoundation/algokit-utils'
import { ApplicationClient } from '@algorandfoundation/algokit-utils/types/app-client';
import appspec from '../application.json'


const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '')
const indexerClient = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', '')

// const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '')
// const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', '')




let nftSwapApp: ApplicationClient
let nftSwapAppId: number

const signTxns = async (unsignedTxns: Array<algosdk.Transaction>) => {
    const signerTransactions = unsignedTxns.map(txn => {
        return {
            txn,
            signers: [algosdk.encodeAddress(txn.from.publicKey)]
        }
    })
    return await peraWallet.signTransaction([signerTransactions])
}

async function signer(txns: algosdk.Transaction[]) {
    return signTxns(txns);
}

// when handling creation, we also fund the contract with 0.1 Algo to account for the minimum balance required
// funding for additional assets will be done whenever a new asset is deposited/swapped  


createBtn.onclick = async () => {
    document.getElementById("status").innerHTML = "Creando app..."
    const sender = {
        addr: accountsList.selectedOptions[0].value,
        signer
    }


    nftSwapApp = algokit.getAppClient(
        {
            app: JSON.stringify(appspec),
            sender: sender,
            creatorAddress: sender.addr,
            indexer: indexerClient,
            id: 0
        },
        algodClient
    )

    await nftSwapApp.create()
    console.log((await nftSwapApp.getAppReference()).appAddress)
    nftSwapAppId = (await nftSwapApp.getAppReference()).appId
    const atc = new algosdk.AtomicTransactionComposer()
    const suggestedParams = await algodClient.getTransactionParams().do()
    const applicationAddress = algosdk.getApplicationAddress(nftSwapAppId)
    const paytxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        suggestedParams,
        amount: 100_000,
        from: sender.addr,
        to: applicationAddress
    })
    // we would like to add the create transaction in the atc
    // here we continue with payment
    atc.addTransaction({
        txn: paytxn,
        signer
    })
    await atc.execute(algodClient, 3)
    document.getElementById('status').innerHTML = `Swap creado con ID ${nftSwapAppId}, contrato fondeado `
    createBtn.disabled = true
    depositBtn.disabled = false
}






// THIRD STEP: deposit NFT into contract
// with compound transaction:
// - fund contract account with 0.1 for the new asset to opt-in
// - have the contract opt-in the NFT to deposit
// - build the NFT transfer to the contract address
// - call the 'deposit' method

const depositBtn = document.getElementById('depositBtn') as HTMLButtonElement
const contract = new algosdk.ABIContract(appspec.contract)



depositBtn.onclick = async () => {
    document.getElementById("status").innerHTML = "Depositando NFT..."

    const sender = accountsList.selectedOptions[0].value
    const atc = new algosdk.AtomicTransactionComposer()

    const suggestedParams = await algodClient.getTransactionParams().do()
    const applicationAddress = algosdk.getApplicationAddress(nftSwapAppId)

    const nftInput = document.getElementById("nft") as HTMLInputElement
    const nft = nftInput.valueAsNumber

    // fund contract account with 0.1 for the new asset to opt-in

    const paytxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        suggestedParams,
        amount: 100_000,
        from: sender,
        to: applicationAddress
    })
    // we would like to add the create transaction in the atc
    // here we continue with payment
    atc.addTransaction({
        txn: paytxn,
        signer
    })




    // Llamar metodo de opt_in
    // const nftInput = document.getElementById("nft") as HTMLInputElement
    // const nft = nftInput.valueAsNumber

    atc.addMethodCall(
        {
            appID: nftSwapAppId,
            method: algosdk.getMethodByName(contract.methods, 'opt_in'),
            sender,
            signer,
            suggestedParams: { ...suggestedParams, fee: 2_000, flatFee: true },
            methodArgs: [nft]
        })


    // Preparar txn de transferencia de asset
    const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        suggestedParams,
        from: sender,
        amount: 1,
        to: applicationAddress,
        assetIndex: nft
    })
    // Llamada de metodo de deposito de nft

    atc.addMethodCall(
        {
            appID: nftSwapAppId,
            method: algosdk.getMethodByName(contract.methods, 'deposit'),
            sender,
            signer,
            suggestedParams,
            methodArgs: [{ txn: axfer, signer }, applicationAddress]
        })
    await atc.execute(algodClient, 3)
    document.getElementById('status').innerHTML = `Asset ${nft} depositado`
    depositBtn.disabled = true
    swapBtn.disabled = false
    withdrawBtn.disabled = false
}


// FOURTH STEP: Swap NFT 
// Compound transaction:
// - Make contract opt-in the new NFT
// - Setup the transfer txn to deposit the new NFT, xfer
// - call 'swap' from the contract with: NFT to withdraw, xfer txn, contract address

const swapBtn = document.getElementById("swapBtn") as HTMLButtonElement




// swapBtn handler with opt-in option for the sender to receive the deposited nft
// and fund contract address with 0.1 Algo for the (possibly) new asset

swapBtn.onclick = async () => {
    const sender = accountsList.selectedOptions[0].value
    const suggestedParams = await algodClient.getTransactionParams().do()
    const applicationAddress = algosdk.getApplicationAddress(nftSwapAppId)
    const atc = new algosdk.AtomicTransactionComposer()
    const nftInput = document.getElementById("nft") as HTMLInputElement
    const nft = nftInput.valueAsNumber
    const swapNftInput = document.getElementById("swapNFT") as HTMLInputElement
    const swapNft = swapNftInput.valueAsNumber

    // fund contract with 0.1 Algo for new asset
    const paytxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        suggestedParams,
        amount: 100_000,
        from: sender,
        to: applicationAddress
    })
    // we would like to add the create transaction in the atc
    // here we continue with payment
    atc.addTransaction({
        txn: paytxn,
        signer
    })


    // contract opt-in nft to swap
    atc.addMethodCall(
        {
            appID: nftSwapAppId,
            method: algosdk.getMethodByName(contract.methods, 'opt_in'),
            sender,
            signer,
            suggestedParams: { ...suggestedParams, fee: 4_000, flatFee: true },
            methodArgs: [swapNft]
        })
    // sender opt-in nft to receive
    const optxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        suggestedParams,
        from: sender,
        amount: 0,
        to: sender,
        assetIndex: nft
    })
    atc.addTransaction({
        txn: optxn,
        signer
    })



    // Preparar txn de transferencia de asset
    const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        suggestedParams,
        from: sender,
        amount: 1,
        to: applicationAddress,
        assetIndex: swapNft
    })
    // Llamar 'swap' method
    atc.addMethodCall(
        {
            appID: nftSwapAppId,
            method: algosdk.getMethodByName(contract.methods, 'swap_nft'),
            sender,
            signer,
            suggestedParams,
            methodArgs: [nft, { txn: axfer, signer }, applicationAddress]
        })
    await atc.execute(algodClient, 3)
    document.getElementById('status').innerHTML = `Asset ${nft} intercambiado por Asset ${swapNft}`
    // update the 'input' elements in the DOM to reflect the swap
    nftInput.value = swapNftInput.value
    swapNftInput.value = ""
    swapBtn.disabled = true
}



// FIFTH STEP: withdraw NFT deposited
// Opt-in the deposited asset, in case is a new one
// Simply call 'withdraw' in the contract

const withdrawBtn = document.getElementById("withdrawBtn") as HTMLButtonElement

withdrawBtn.onclick = async () => {
    const suggestedParams = await algodClient.getTransactionParams().do()
    const sender = accountsList.selectedOptions[0].value
    const atc = new algosdk.AtomicTransactionComposer()

    const nftInput = document.getElementById("nft") as HTMLInputElement
    const nft = nftInput.valueAsNumber

    // opt-in nft deposited
    const optxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        suggestedParams,
        from: sender,
        amount: 0,
        to: sender,
        assetIndex: nft
    })
    atc.addTransaction({
        txn: optxn,
        signer
    })

    atc.addMethodCall(
        {
            appID: nftSwapAppId,
            methodArgs: [nft],
            method: algosdk.getMethodByName(contract.methods, 'withdraw_nft'),
            sender: accountsList.selectedOptions[0].value,
            signer,
            suggestedParams: { ...suggestedParams, fee: 2_000, flatFee: true }
        }
    )

    atc.execute(algodClient, 3)
    // update 'nft' input field
    nftInput.value = ""
    depositBtn.disabled = false
    swapBtn.disabled = true
    withdrawBtn.disabled = true
    document.getElementById('status').innerHTML = `Asset ${nft} retirado, puedes reinciar el swap`

}
