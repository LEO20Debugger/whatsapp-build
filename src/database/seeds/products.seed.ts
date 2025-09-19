import { DatabaseService } from "../database.service";
import { products } from "../schema";

export const seedProducts = async (db: DatabaseService) => {
  const testProducts = [
    {
      name: "Classic Burger",
      description:
        "Juicy beef patty with lettuce, tomato, and our special sauce",
      price: "12.99",
      category: "Burgers",
      stockQuantity: 50,
      sku: "BURGER-001",
      available: true,
    },
    {
      name: "Chicken Wings (6pc)",
      description: "Crispy chicken wings with your choice of sauce",
      price: "8.99",
      category: "Appetizers",
      stockQuantity: 30,
      sku: "WINGS-001",
      available: true,
    },
    {
      name: "Margherita Pizza",
      description: "Fresh mozzarella, tomato sauce, and basil",
      price: "15.99",
      category: "Pizza",
      stockQuantity: 25,
      sku: "PIZZA-001",
      available: true,
    },
    {
      name: "Caesar Salad",
      description: "Crisp romaine lettuce with Caesar dressing and croutons",
      price: "9.99",
      category: "Salads",
      stockQuantity: 40,
      sku: "SALAD-001",
      available: true,
    },
    {
      name: "Chocolate Cake",
      description: "Rich chocolate cake with chocolate frosting",
      price: "6.99",
      category: "Desserts",
      stockQuantity: 15,
      sku: "CAKE-001",
      available: true,
    },
    {
      name: "Fish & Chips",
      description: "Beer-battered fish with crispy fries",
      price: "14.99",
      category: "Main Course",
      stockQuantity: 20,
      sku: "FISH-001",
      available: true,
    },
    {
      name: "Soft Drink",
      description: "Choice of Coke, Pepsi, or Sprite",
      price: "2.99",
      category: "Beverages",
      stockQuantity: 100,
      sku: "DRINK-001",
      available: true,
    },
    {
      name: "French Fries",
      description: "Crispy golden fries with sea salt",
      price: "4.99",
      category: "Sides",
      stockQuantity: 60,
      sku: "FRIES-001",
      available: true,
    },
  ];

  try {
    console.log("Seeding products...");

    // Check if products already exist
    const existingProducts = await db.db.select().from(products).limit(1);

    if (existingProducts.length > 0) {
      console.log("Products already exist, skipping seed");
      return;
    }

    // Insert test products
    await db.db.insert(products).values(testProducts);

    console.log(`Successfully seeded ${testProducts.length} products`);
  } catch (error) {
    console.error("Error seeding products:", error);
    throw error;
  }
};
