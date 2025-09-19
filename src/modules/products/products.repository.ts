import { Injectable, Logger } from '@nestjs/common';
import { eq, like, desc, asc, and, gte, lte, ilike } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { products } from '../../database/schema';
import { Product, NewProduct } from '../../database/types';

export interface ProductSearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'name' | 'price' | 'createdAt' | 'stockQuantity';
  sortOrder?: 'asc' | 'desc';
  category?: string;
  availableOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
}

@Injectable()
export class ProductsRepository {
  private readonly logger = new Logger(ProductsRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(productData: NewProduct): Promise<Product> {
    try {
      const [product] = await this.databaseService.db
        .insert(products)
        .values(productData)
        .returning();

      this.logger.log(`Created product with ID: ${product.id}`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to create product: ${error.message}`);
      throw error;
    }
  }

  async findById(id: string): Promise<Product | null> {
    try {
      const [product] = await this.databaseService.db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);

      return product || null;
    } catch (error) {
      this.logger.error(`Failed to find product by ID ${id}: ${error.message}`);
      throw error;
    }
  }

  async findBySku(sku: string): Promise<Product | null> {
    try {
      const [product] = await this.databaseService.db
        .select()
        .from(products)
        .where(eq(products.sku, sku))
        .limit(1);

      return product || null;
    } catch (error) {
      this.logger.error(`Failed to find product by SKU ${sku}: ${error.message}`);
      throw error;
    }
  }

  async findAvailableProducts(options: ProductSearchOptions = {}): Promise<Product[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'name',
        sortOrder = 'asc',
        category,
        minPrice,
        maxPrice,
        inStock = false
      } = options;

      let whereConditions = [eq(products.available, true)];

      // Add category filter
      if (category) {
        whereConditions.push(eq(products.category, category));
      }

      // Add price range filters
      if (minPrice !== undefined) {
        whereConditions.push(gte(products.price, minPrice.toString()));
      }
      if (maxPrice !== undefined) {
        whereConditions.push(lte(products.price, maxPrice.toString()));
      }

      // Add stock filter
      if (inStock) {
        whereConditions.push(gte(products.stockQuantity, 1));
      }

      const sortColumn = products[sortBy];
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      const productList = await this.databaseService.db
        .select()
        .from(products)
        .where(and(...whereConditions))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return productList;
    } catch (error) {
      this.logger.error(`Failed to find available products: ${error.message}`);
      throw error;
    }
  }

  async searchProducts(searchTerm: string, options: ProductSearchOptions = {}): Promise<Product[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'name',
        sortOrder = 'asc',
        availableOnly = true,
        category,
        minPrice,
        maxPrice,
        inStock = false
      } = options;

      let whereConditions = [
        // Search in name and description
        like(products.name, `%${searchTerm}%`)
      ];

      // Add availability filter
      if (availableOnly) {
        whereConditions.push(eq(products.available, true));
      }

      // Add category filter
      if (category) {
        whereConditions.push(eq(products.category, category));
      }

      // Add price range filters
      if (minPrice !== undefined) {
        whereConditions.push(gte(products.price, minPrice.toString()));
      }
      if (maxPrice !== undefined) {
        whereConditions.push(lte(products.price, maxPrice.toString()));
      }

      // Add stock filter
      if (inStock) {
        whereConditions.push(gte(products.stockQuantity, 1));
      }

      const sortColumn = products[sortBy];
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      const productList = await this.databaseService.db
        .select()
        .from(products)
        .where(and(...whereConditions))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return productList;
    } catch (error) {
      this.logger.error(`Failed to search products with term "${searchTerm}": ${error.message}`);
      throw error;
    }
  }

  async findByCategory(category: string, options: ProductSearchOptions = {}): Promise<Product[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'name',
        sortOrder = 'asc',
        availableOnly = true,
        inStock = false
      } = options;

      let whereConditions = [eq(products.category, category)];

      // Add availability filter
      if (availableOnly) {
        whereConditions.push(eq(products.available, true));
      }

      // Add stock filter
      if (inStock) {
        whereConditions.push(gte(products.stockQuantity, 1));
      }

      const sortColumn = products[sortBy];
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      const productList = await this.databaseService.db
        .select()
        .from(products)
        .where(and(...whereConditions))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return productList;
    } catch (error) {
      this.logger.error(`Failed to find products by category "${category}": ${error.message}`);
      throw error;
    }
  }

  async update(id: string, updateData: Partial<NewProduct>): Promise<Product> {
    try {
      const [product] = await this.databaseService.db
        .update(products)
        .set(updateData)
        .where(eq(products.id, id))
        .returning();

      if (!product) {
        throw new Error(`Product with ID ${id} not found`);
      }

      this.logger.log(`Updated product with ID: ${id}`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to update product ${id}: ${error.message}`);
      throw error;
    }
  }

  async updateStock(id: string, quantity: number): Promise<Product> {
    try {
      const [product] = await this.databaseService.db
        .update(products)
        .set({ stockQuantity: quantity })
        .where(eq(products.id, id))
        .returning();

      if (!product) {
        throw new Error(`Product with ID ${id} not found`);
      }

      this.logger.log(`Updated stock for product ${id} to ${quantity}`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to update stock for product ${id}: ${error.message}`);
      throw error;
    }
  }

  async decrementStock(id: string, quantity: number): Promise<Product> {
    try {
      // First get current product to check stock
      const currentProduct = await this.findById(id);
      if (!currentProduct) {
        throw new Error(`Product with ID ${id} not found`);
      }

      const newQuantity = currentProduct.stockQuantity - quantity;
      if (newQuantity < 0) {
        throw new Error(`Insufficient stock. Available: ${currentProduct.stockQuantity}, Requested: ${quantity}`);
      }

      const [product] = await this.databaseService.db
        .update(products)
        .set({ stockQuantity: newQuantity })
        .where(eq(products.id, id))
        .returning();

      this.logger.log(`Decremented stock for product ${id} by ${quantity}. New stock: ${newQuantity}`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to decrement stock for product ${id}: ${error.message}`);
      throw error;
    }
  }

  async incrementStock(id: string, quantity: number): Promise<Product> {
    try {
      const currentProduct = await this.findById(id);
      if (!currentProduct) {
        throw new Error(`Product with ID ${id} not found`);
      }

      const newQuantity = currentProduct.stockQuantity + quantity;

      const [product] = await this.databaseService.db
        .update(products)
        .set({ stockQuantity: newQuantity })
        .where(eq(products.id, id))
        .returning();

      this.logger.log(`Incremented stock for product ${id} by ${quantity}. New stock: ${newQuantity}`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to increment stock for product ${id}: ${error.message}`);
      throw error;
    }
  }

  async setAvailability(id: string, available: boolean): Promise<Product> {
    try {
      const [product] = await this.databaseService.db
        .update(products)
        .set({ available })
        .where(eq(products.id, id))
        .returning();

      if (!product) {
        throw new Error(`Product with ID ${id} not found`);
      }

      this.logger.log(`Set availability for product ${id} to ${available}`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to set availability for product ${id}: ${error.message}`);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.databaseService.db
        .delete(products)
        .where(eq(products.id, id));

      // For postgres-js, result is an array with count property
      const deleted = (result as any).count > 0;
      if (deleted) {
        this.logger.log(`Deleted product with ID: ${id}`);
      } else {
        this.logger.warn(`Product with ID ${id} not found for deletion`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete product ${id}: ${error.message}`);
      throw error;
    }
  }

  async findAll(options: ProductSearchOptions = {}): Promise<Product[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'name',
        sortOrder = 'asc',
        availableOnly = false,
        category,
        minPrice,
        maxPrice,
        inStock = false
      } = options;

      let whereConditions = [];

      // Add availability filter
      if (availableOnly) {
        whereConditions.push(eq(products.available, true));
      }

      // Add category filter
      if (category) {
        whereConditions.push(eq(products.category, category));
      }

      // Add price range filters
      if (minPrice !== undefined) {
        whereConditions.push(gte(products.price, minPrice.toString()));
      }
      if (maxPrice !== undefined) {
        whereConditions.push(lte(products.price, maxPrice.toString()));
      }

      // Add stock filter
      if (inStock) {
        whereConditions.push(gte(products.stockQuantity, 1));
      }

      const sortColumn = products[sortBy];
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      let query = this.databaseService.db
        .select()
        .from(products);

      if (whereConditions.length > 0) {
        query = query.where(and(...whereConditions));
      }

      const productList = await query
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return productList;
    } catch (error) {
      this.logger.error(`Failed to find products: ${error.message}`);
      throw error;
    }
  }

  async getCategories(): Promise<string[]> {
    try {
      const result = await this.databaseService.db
        .select({ category: products.category })
        .from(products)
        .where(eq(products.available, true));

      // Extract unique categories and filter out nulls
      const categories = [...new Set(result.map(r => r.category).filter(Boolean))];
      return categories;
    } catch (error) {
      this.logger.error(`Failed to get categories: ${error.message}`);
      throw error;
    }
  }

  async count(options: ProductSearchOptions = {}): Promise<number> {
    try {
      const {
        availableOnly = false,
        category,
        minPrice,
        maxPrice,
        inStock = false
      } = options;

      let whereConditions = [];

      // Add availability filter
      if (availableOnly) {
        whereConditions.push(eq(products.available, true));
      }

      // Add category filter
      if (category) {
        whereConditions.push(eq(products.category, category));
      }

      // Add price range filters
      if (minPrice !== undefined) {
        whereConditions.push(gte(products.price, minPrice.toString()));
      }
      if (maxPrice !== undefined) {
        whereConditions.push(lte(products.price, maxPrice.toString()));
      }

      // Add stock filter
      if (inStock) {
        whereConditions.push(gte(products.stockQuantity, 1));
      }

      let query = this.databaseService.db
        .select()
        .from(products);

      if (whereConditions.length > 0) {
        query = query.where(and(...whereConditions));
      }

      const result = await query;
      return result.length;
    } catch (error) {
      this.logger.error(`Failed to count products: ${error.message}`);
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const product = await this.findById(id);
      return product !== null;
    } catch (error) {
      this.logger.error(`Failed to check if product exists ${id}: ${error.message}`);
      throw error;
    }
  }

  async skuExists(sku: string): Promise<boolean> {
    try {
      const product = await this.findBySku(sku);
      return product !== null;
    } catch (error) {
      this.logger.error(`Failed to check if SKU exists ${sku}: ${error.message}`);
      throw error;
    }
  }

  async isAvailable(id: string): Promise<boolean> {
    try {
      const product = await this.findById(id);
      return product ? product.available : false;
    } catch (error) {
      this.logger.error(`Failed to check if product is available ${id}: ${error.message}`);
      throw error;
    }
  }

  async hasStock(id: string, requiredQuantity: number = 1): Promise<boolean> {
    try {
      const product = await this.findById(id);
      return product ? product.stockQuantity >= requiredQuantity : false;
    } catch (error) {
      this.logger.error(`Failed to check stock for product ${id}: ${error.message}`);
      throw error;
    }
  }
}