import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  ProductsRepository,
  ProductSearchOptions,
} from "./products.repository";
import { Product, NewProduct } from "../../database/types";

export interface ProductCatalogOptions {
  category?: string;
  availableOnly?: boolean;
  inStock?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "name" | "price" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface ProductSearchFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  availableOnly?: boolean;
  inStock?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly productsRepository: ProductsRepository) {}

  /**
   * Retrieve product catalog with filtering and pagination
   * Requirements: 1.1, 5.1, 5.3
   */
  async getProductCatalog(
    options: ProductCatalogOptions = {},
  ): Promise<Product[]> {
    try {
      const {
        category,
        availableOnly = true,
        inStock = false,
        limit = 50,
        offset = 0,
        sortBy = "name",
        sortOrder = "asc",
      } = options;

      const searchOptions: ProductSearchOptions = {
        category,
        availableOnly,
        inStock,
        limit,
        offset,
        sortBy,
        sortOrder,
      };

      this.logger.log(
        `Retrieving product catalog with options: ${JSON.stringify(searchOptions)}`,
      );

      const products =
        await this.productsRepository.findAvailableProducts(searchOptions);

      this.logger.log(`Retrieved ${products.length} products from catalog`);
      return products;
    } catch (error) {
      this.logger.error(`Failed to retrieve product catalog: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all available products (simplified catalog access)
   * Requirements: 1.1, 5.1
   */
  async getAvailableProducts(): Promise<Product[]> {
    try {
      this.logger.log("Retrieving all available products");

      const products = await this.productsRepository.findAvailableProducts({
        availableOnly: true,
        inStock: true,
        sortBy: "name",
        sortOrder: "asc",
      });

      this.logger.log(`Retrieved ${products.length} available products`);
      return products;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve available products: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Search products by name or description
   * Requirements: 1.4, 5.3
   */
  async searchProducts(
    searchTerm: string,
    filters: ProductSearchFilters = {},
  ): Promise<Product[]> {
    try {
      if (!searchTerm || searchTerm.trim().length === 0) {
        throw new BadRequestException("Search term cannot be empty");
      }

      const {
        category,
        minPrice,
        maxPrice,
        availableOnly = true,
        inStock = false,
        limit = 50,
        offset = 0,
      } = filters;

      const searchOptions: ProductSearchOptions = {
        category,
        minPrice,
        maxPrice,
        availableOnly,
        inStock,
        limit,
        offset,
        sortBy: "name",
        sortOrder: "asc",
      };

      this.logger.log(
        `Searching products with term: "${searchTerm}" and filters: ${JSON.stringify(searchOptions)}`,
      );

      const products = await this.productsRepository.searchProducts(
        searchTerm.trim(),
        searchOptions,
      );

      this.logger.log(
        `Found ${products.length} products matching search term: "${searchTerm}"`,
      );
      return products;
    } catch (error) {
      this.logger.error(
        `Failed to search products with term "${searchTerm}": ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get products by category
   * Requirements: 1.1, 5.3
   */
  async getProductsByCategory(
    category: string,
    options: ProductCatalogOptions = {},
  ): Promise<Product[]> {
    try {
      if (!category || category.trim().length === 0) {
        throw new BadRequestException("Category cannot be empty");
      }

      const {
        availableOnly = true,
        inStock = false,
        limit = 50,
        offset = 0,
        sortBy = "name",
        sortOrder = "asc",
      } = options;

      const searchOptions: ProductSearchOptions = {
        availableOnly,
        inStock,
        limit,
        offset,
        sortBy,
        sortOrder,
      };

      this.logger.log(`Retrieving products for category: "${category}"`);

      const products = await this.productsRepository.findByCategory(
        category.trim(),
        searchOptions,
      );

      this.logger.log(
        `Retrieved ${products.length} products for category: "${category}"`,
      );
      return products;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve products for category "${category}": ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get product by ID
   * Requirements: 1.1, 5.1
   */
  async getProductById(id: string): Promise<Product> {
    try {
      if (!id || id.trim().length === 0) {
        throw new BadRequestException("Product ID cannot be empty");
      }

      this.logger.log(`Retrieving product by ID: ${id}`);

      const product = await this.productsRepository.findById(id.trim());

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      this.logger.log(`Retrieved product: ${product.name} (ID: ${id})`);
      return product;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve product by ID ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get product by SKU
   * Requirements: 1.1, 5.1
   */
  async getProductBySku(sku: string): Promise<Product> {
    try {
      if (!sku || sku.trim().length === 0) {
        throw new BadRequestException("Product SKU cannot be empty");
      }

      this.logger.log(`Retrieving product by SKU: ${sku}`);

      const product = await this.productsRepository.findBySku(sku.trim());

      if (!product) {
        throw new NotFoundException(`Product with SKU ${sku} not found`);
      }

      this.logger.log(`Retrieved product: ${product.name} (SKU: ${sku})`);
      return product;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve product by SKU ${sku}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get all product categories
   * Requirements: 1.1, 5.3
   */
  async getCategories(): Promise<string[]> {
    try {
      this.logger.log("Retrieving all product categories");

      const categories = await this.productsRepository.getCategories();

      this.logger.log(`Retrieved ${categories.length} categories`);
      return categories;
    } catch (error) {
      this.logger.error(`Failed to retrieve categories: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if product is available and in stock
   * Requirements: 1.4, 5.4
   */
  async isProductAvailable(
    id: string,
    requiredQuantity: number = 1,
  ): Promise<boolean> {
    try {
      if (!id || id.trim().length === 0) {
        throw new BadRequestException("Product ID cannot be empty");
      }

      if (requiredQuantity < 1) {
        throw new BadRequestException("Required quantity must be at least 1");
      }

      this.logger.log(
        `Checking availability for product ${id} with quantity ${requiredQuantity}`,
      );

      const product = await this.productsRepository.findById(id.trim());

      if (!product) {
        this.logger.log(`Product ${id} not found`);
        return false;
      }

      const isAvailable =
        product.available && product.stockQuantity >= requiredQuantity;

      this.logger.log(
        `Product ${id} availability: ${isAvailable} (available: ${product.available}, stock: ${product.stockQuantity})`,
      );
      return isAvailable;
    } catch (error) {
      this.logger.error(
        `Failed to check availability for product ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Validate multiple products for order creation
   * Requirements: 1.4, 5.4
   */
  async validateProductsForOrder(
    productRequests: Array<{ productId: string; quantity: number }>,
  ): Promise<{
    valid: boolean;
    validProducts: Array<{ product: Product; quantity: number }>;
    invalidProducts: Array<{
      productId: string;
      quantity: number;
      reason: string;
    }>;
  }> {
    try {
      this.logger.log(
        `Validating ${productRequests.length} products for order`,
      );

      const validProducts: Array<{ product: Product; quantity: number }> = [];
      const invalidProducts: Array<{
        productId: string;
        quantity: number;
        reason: string;
      }> = [];

      for (const request of productRequests) {
        const { productId, quantity } = request;

        // Validate quantity
        if (quantity < 1) {
          invalidProducts.push({
            productId,
            quantity,
            reason: "Quantity must be at least 1",
          });
          continue;
        }

        try {
          // Get product
          const product = await this.productsRepository.findById(productId);

          if (!product) {
            invalidProducts.push({
              productId,
              quantity,
              reason: "Product not found",
            });
            continue;
          }

          // Check availability
          if (!product.available) {
            invalidProducts.push({
              productId,
              quantity,
              reason: "Product is not available",
            });
            continue;
          }

          // Check stock
          if (product.stockQuantity < quantity) {
            invalidProducts.push({
              productId,
              quantity,
              reason: `Insufficient stock. Available: ${product.stockQuantity}, Requested: ${quantity}`,
            });
            continue;
          }

          // Product is valid
          validProducts.push({ product, quantity });
        } catch (error) {
          invalidProducts.push({
            productId,
            quantity,
            reason: `Error validating product: ${error.message}`,
          });
        }
      }

      const valid = invalidProducts.length === 0;

      this.logger.log(
        `Product validation complete: ${validProducts.length} valid, ${invalidProducts.length} invalid`,
      );

      return {
        valid,
        validProducts,
        invalidProducts,
      };
    } catch (error) {
      this.logger.error(
        `Failed to validate products for order: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get product count with filters
   * Requirements: 5.3
   */
  async getProductCount(filters: ProductSearchFilters = {}): Promise<number> {
    try {
      const {
        category,
        minPrice,
        maxPrice,
        availableOnly = false,
        inStock = false,
      } = filters;

      const searchOptions: ProductSearchOptions = {
        category,
        minPrice,
        maxPrice,
        availableOnly,
        inStock,
      };

      this.logger.log(
        `Counting products with filters: ${JSON.stringify(searchOptions)}`,
      );

      const count = await this.productsRepository.count(searchOptions);

      this.logger.log(`Product count: ${count}`);
      return count;
    } catch (error) {
      this.logger.error(`Failed to count products: ${error.message}`);
      throw error;
    }
  }

  /**
   * Filter products by price range
   * Requirements: 5.3
   */
  async getProductsByPriceRange(
    minPrice: number,
    maxPrice: number,
    options: ProductCatalogOptions = {},
  ): Promise<Product[]> {
    try {
      if (minPrice < 0 || maxPrice < 0) {
        throw new BadRequestException("Price values cannot be negative");
      }

      if (minPrice > maxPrice) {
        throw new BadRequestException(
          "Minimum price cannot be greater than maximum price",
        );
      }

      const {
        category,
        availableOnly = true,
        inStock = false,
        limit = 50,
        offset = 0,
        sortBy = "price",
        sortOrder = "asc",
      } = options;

      const searchOptions: ProductSearchOptions = {
        category,
        minPrice,
        maxPrice,
        availableOnly,
        inStock,
        limit,
        offset,
        sortBy,
        sortOrder,
      };

      this.logger.log(
        `Retrieving products in price range ${minPrice} - ${maxPrice}`,
      );

      const products =
        await this.productsRepository.findAvailableProducts(searchOptions);

      this.logger.log(
        `Retrieved ${products.length} products in price range ${minPrice} - ${maxPrice}`,
      );
      return products;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve products by price range: ${error.message}`,
      );
      throw error;
    }
  }
}
