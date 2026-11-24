import { MemoryStore } from "../src/store.js";
import { storeContract } from "./store.contract.js";

storeContract("In-memory", async () => new MemoryStore());
