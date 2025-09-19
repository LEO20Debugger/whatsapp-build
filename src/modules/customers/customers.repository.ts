import { Injectable, Logger } from "@nestjs/common";
import { eq, like, desc, asc } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { customers } from "../../database/schema";
import { Customer, NewCustomer, UpdateCustomer } from "../../database/types";

export interface CustomerSearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: "name" | "phoneNumber" | "createdAt";
  sortOrder?: "asc" | "desc";
}

@Injectable()
export class CustomersRepository {
  private readonly logger = new Logger(CustomersRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /** Create New Customer */
  async create(customerData: NewCustomer): Promise<Customer> {
    /** set table alias */
    const c = customers;

    /** build and run query */
    try {
      const [customer] = await this.databaseService.db
        .insert(c)
        .values(customerData)
        .returning();

      this.logger.log(`Created customer with ID: ${customer.id}`);
      return customer;
    } catch (error) {
      this.logger.error(`Failed to create customer: ${error.message}`);
      throw error;
    }
  }

  /** Find One Customer By  Id */
  async findById(id: string): Promise<Customer | null> {
    /** set table alias */
    const c = customers;

    /** build and run query */
    try {
      const [customer] = await this.databaseService.db
        .select()
        .from(c)
        .where(eq(c.id, id))
        .limit(1);

      return customer || null;
    } catch (error) {
      this.logger.error(
        `Failed to find customer by ID ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  /** Find One Customer By Phone Number */
  async findByPhoneNumber(phoneNumber: string): Promise<Customer | null> {
    /** set table alias */
    const c = customers;

    /** build and run query */
    try {
      const [customer] = await this.databaseService.db
        .select()
        .from(c)
        .where(eq(c.phoneNumber, phoneNumber))
        .limit(1);

      return customer || null;
    } catch (error) {
      this.logger.error(
        `Failed to find customer by phone number ${phoneNumber}: ${error.message}`,
      );
      throw error;
    }
  }

  async findOrCreateByPhoneNumber(
    phoneNumber: string,
    name?: string,
  ): Promise<Customer> {
    try {
      // First try to find existing customer
      let customer = await this.findByPhoneNumber(phoneNumber);

      if (!customer) {
        // Create new customer if not found
        const newCustomerData: NewCustomer = {
          phoneNumber,
          ...(name && { name }),
        };
        customer = await this.create(newCustomerData);
        this.logger.log(
          `Created new customer for phone number: ${phoneNumber}`,
        );
      } else if (name && !customer.name) {
        // Update name if customer exists but doesn't have a name
        customer = await this.update(customer.id, { name });
        this.logger.log(
          `Updated customer name for phone number: ${phoneNumber}`,
        );
      }

      return customer;
    } catch (error) {
      this.logger.error(
        `Failed to find or create customer for phone number ${phoneNumber}: ${error.message}`,
      );
      throw error;
    }
  }

  async update(id: string, updateData: UpdateCustomer): Promise<Customer> {
    try {
      const [customer] = await this.databaseService.db
        .update(customers)
        .set(updateData)
        .where(eq(customers.id, id))
        .returning();

      if (!customer) {
        throw new Error(`Customer with ID ${id} not found`);
      }

      this.logger.log(`Updated customer with ID: ${id}`);
      return customer;
    } catch (error) {
      this.logger.error(`Failed to update customer ${id}: ${error.message}`);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.databaseService.db
        .delete(customers)
        .where(eq(customers.id, id));

      // For postgres-js, result is an array with count property
      const deleted = (result as any).count > 0;
      if (deleted) {
        this.logger.log(`Deleted customer with ID: ${id}`);
      } else {
        this.logger.warn(`Customer with ID ${id} not found for deletion`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete customer ${id}: ${error.message}`);
      throw error;
    }
  }

  async findAll(options: CustomerSearchOptions = {}): Promise<Customer[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;

      const sortColumn = customers[sortBy];
      const orderByClause =
        sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

      const customerList = await this.databaseService.db
        .select()
        .from(customers)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return customerList;
    } catch (error) {
      this.logger.error(`Failed to find customers: ${error.message}`);
      throw error;
    }
  }

  async searchByName(
    searchTerm: string,
    options: CustomerSearchOptions = {},
  ): Promise<Customer[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = "name",
        sortOrder = "asc",
      } = options;

      const sortColumn = customers[sortBy];
      const orderByClause =
        sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

      const customerList = await this.databaseService.db
        .select()
        .from(customers)
        .where(like(customers.name, `%${searchTerm}%`))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return customerList;
    } catch (error) {
      this.logger.error(
        `Failed to search customers by name "${searchTerm}": ${error.message}`,
      );
      throw error;
    }
  }

  async count(): Promise<number> {
    try {
      const result = await this.databaseService.db.select().from(customers);

      return result.length;
    } catch (error) {
      this.logger.error(`Failed to count customers: ${error.message}`);
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const customer = await this.findById(id);
      return customer !== null;
    } catch (error) {
      this.logger.error(
        `Failed to check if customer exists ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  async phoneNumberExists(phoneNumber: string): Promise<boolean> {
    try {
      const customer = await this.findByPhoneNumber(phoneNumber);
      return customer !== null;
    } catch (error) {
      this.logger.error(
        `Failed to check if phone number exists ${phoneNumber}: ${error.message}`,
      );
      throw error;
    }
  }
}
