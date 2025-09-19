import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CustomersRepository } from "./customers.repository";

@Module({
  imports: [DatabaseModule],
  providers: [CustomersRepository],
  exports: [CustomersRepository],
})
export class CustomersModule {}
