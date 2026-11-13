import "../css/pay3.css";
import { runCheckout } from "../checkout.js";
import { makeCard } from "../themes/card.js";

runCheckout(makeCard());
