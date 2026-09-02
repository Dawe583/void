import { Router, type IRouter } from "express";
import healthRouter from "./health";
import waitlistRouter from "./waitlist";
import contactRouter from "./contact";
import statusRouter from "./status";

const router: IRouter = Router();

router.use(healthRouter);
router.use(waitlistRouter);
router.use(contactRouter);
router.use(statusRouter);

export default router;
