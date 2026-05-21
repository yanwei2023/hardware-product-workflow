import { checkGateReadiness } from "./gateEngine";
import { sampleGateCheckInput } from "./sampleData";

const result = checkGateReadiness(sampleGateCheckInput);

console.log(JSON.stringify(result, null, 2));

