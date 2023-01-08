You don't have to use this directory, but if you are keen on MVC concept, this would be the place for your models.

There are not specific rules for these files. They are never loaded automaticallt by the framework, instead you should
load them where you want to use them.

Usually a model will export a class or a class instance, but it could be a function, set of functions, or anything really.

Models are meant to abstract the logic and data layer for a specific entity of your app. For example a web shop would likely
have a model Product.ts which exports a class with methods such as create(productData: ProductData) to create a new product and delete(productId: number) to delete an existing product.