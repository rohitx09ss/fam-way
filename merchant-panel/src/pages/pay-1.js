import "../css/pay1.css";
import { runCheckout } from "../checkout.js";
import { makeClassic } from "../themes/classic.js";

runCheckout(makeClassic({ styled: false }));
