---
name: bulk-expense
description: Insert bulk expenses into persistent storage
---

I will provide you with a CSV list of expenses that must include, at a minumum, the date and amount of the expense. If I do not tell you the category and item name to use for the expenses, then you should prompt me with a numbered list of all existing category/item names in the format "CATEGORY - ITEM NAME". I must tell you which number to use.

I can also provide you a CSV list that also contains the category and item name on each row along with the date and amount. If that is the format that I provide, then you should use the provided information to determine which category and item name to use for each row. However, you must still verify that the category and item name is one that is already defined in the expenses catelog before writing to the data store.

You should assume that the data is to be written to the DynamoDB data store in AWS. You will need to test to ensure that local login credentials are available for you to use and, if not, prompt me to login in an refresh them.
