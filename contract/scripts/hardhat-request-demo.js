const hre = require("hardhat");

const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const RESOURCE_OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const REQUESTER_PRIV = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function main() {
	const provider = hre.ethers.provider;
	const requester = new hre.ethers.Wallet(REQUESTER_PRIV, provider);
	const contract = await hre.ethers.getContractAt("AccessManagement", CONTRACT_ADDRESS, requester);

	console.log("📡 Connected as", requester.address);
	console.log("🔗 Target contract", CONTRACT_ADDRESS);

	const before = await contract.getRequestId(RESOURCE_OWNER);
	console.log("📋 Existing request IDs for resource owner:", before.map((id) => id.toString()));

	console.log("🚀 Sending saveRequest transaction...");
	const tx = await contract.saveRequest(RESOURCE_OWNER, "Hardhat Demo", "Demo Organization");
	console.log("🧾 Tx hash:", tx.hash);
	const receipt = await tx.wait();
	console.log("✅ Mined in block", receipt.blockNumber);

	const event = receipt.events?.find((evt) => evt.event === "AccessRequestsSaved");
	const requestId = event ? event.args.requestId.toString() : null;
	if (requestId) {
		console.log("🆔 New requestId:", requestId);
		const detail = await contract.getRequestById(requestId);
		console.log("📦 Request detail:", {
			requester: detail.requester,
			resourceOwner: detail.resourceOwner,
			status: detail.status,
			purpose: detail.purpose,
			organizationName: detail.organizationName,
		});
	}

	const after = await contract.getRequestId(RESOURCE_OWNER);
	console.log("📋 Updated request IDs:", after.map((id) => id.toString()));
}

main().catch((err) => {
	console.error("❌ Script failed:", err);
	process.exit(1);
});
