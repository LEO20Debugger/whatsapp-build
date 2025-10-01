import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { OrdersModule } from "../orders/orders.module";
import { PaymentsRepository } from "./payments.repository";
import { PaymentsService } from "./payments.service";
import { ReceiptVerificationService } from "./services/receipt-verification.service";
import { PdfReceiptService } from "./services/pdf-receipt.service";

@Module({
  imports: [DatabaseModule, OrdersModule],
  providers: [PaymentsRepository, PaymentsService, ReceiptVerificationService, PdfReceiptService],
  exports: [PaymentsRepository, PaymentsService, ReceiptVerificationService, PdfReceiptService],
})
export class PaymentsModule {}
