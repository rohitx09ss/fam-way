import "../css/pay2.css";
import { runCheckout } from "../checkout.js";
import { makeClassic } from "../themes/classic.js";

runCheckout(makeClassic({ styled: true }));
