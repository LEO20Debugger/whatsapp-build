import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { PaymentsRepository } from "./payments.repository";

@Module({
  imports: [DatabaseModule],
  providers: [PaymentsRepository],
  exports: [PaymentsRepository],
})
export class PaymentsModule {}
