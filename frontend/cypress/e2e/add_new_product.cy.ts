/// <reference types="Cypress" />

const emailNewProduct = Cypress.env('login_Email');
const passwordNewProduct = Cypress.env('login_Password');

describe('Product Page Test Flow and Validations', () => {

    beforeEach(() => {
        // Logging In -
        cy.intercept('POST', '**/api/method/login').as('loginRequest');

        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]', { timeout: 3000}).should('be.visible').type(emailNewProduct);
        cy.get('[data-cy="username-login-input-password"]', { timeout: 3000}).should('be.visible').type(passwordNewProduct);
        cy.get('[data-cy="login-button"]', { timeout: 3000}).should('be.visible').click();    

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('validates the Products card', () => {
        
        // Select the Products card
        cy.get('[data-cy="admin-dashboard-products-card"]')
            .should('exist')
            .and('be.visible');

        // Check href in the anchor tag
        cy.get('[data-cy="admin-dashboard-products-card"] a')
            .should('have.attr', 'href', '/products');

        // Validate heading text
        cy.get('[data-cy="admin-dashboard-products-card"] h3')
            .should('contain.text', 'Products');

        // Validate presence of the shopping cart icon (SVG)
        cy.get('[data-cy="admin-dashboard-products-card"] svg')
            .should('be.visible')
            .and('have.class', 'lucide-shopping-cart');

        // Validate the product count is a number and styled correctly
        cy.get('[data-cy="admin-dashboard-products-card"] .text-2xl.font-bold')
            .should('be.visible')
            .should(($el) => {
                const text = $el.text().trim();
                expect(text.length, 'Text should not be empty').to.be.greaterThan(0);
                // cy.log(`${text.length}`);
            })
            .invoke('text')
            .then((text) => {
                cy.log(`Product card number: "${text}"`);
                const cleaned = text.replace(/[^\d]/g, '');
                expect(cleaned.length, `Expected a digit in "${text}"`).to.be.greaterThan(0);
                const count = parseInt(cleaned, 10);
                expect(count).to.be.a('number');
                expect(count).to.be.greaterThan(0);
            });

    });

    it('Navigates to Products page, checks the correct page and Adds a New Vendor', () => {
        
        // Navigating to Products Page
        cy.get('[data-cy="admin-dashboard-products-card"]', { timeout: 6000 })
            .should('exist')
            .and('be.visible')
            .click();

        // Asserting that the "Total Products" card is present and contains expected text
        cy.contains('h3', 'Total Products')
            .should('be.visible')
            .closest('div.rounded-xl.border')
            .within(() => {
                // Waiting for a moment if the text might render asynchronously
                cy.get('.text-2xl.font-bold', { timeout: 10000 })
                    .should('exist')
                    .invoke('text')
                        .then((text) => {
                            cy.log(`Total Products Count: "${text.trim()}"`);
                            const cleaned = text.replace(/[^\d]/g, '');
                            expect(cleaned.length, 'Should contain at least one digit').to.be.greaterThan(0);
                            const count = parseInt(cleaned, 10);
                            expect(count, 'Parsed count').to.be.a('number');
                            expect(count).to.be.greaterThan(0);
                });
                cy.contains('p', 'Unique products in the system').should('be.visible');
            });

        cy.url().should('include', '/products');
        cy.contains('Total Products').should('exist');

        // Add New Product Button
        // cy.contains('button', /Add(New Product)?/i)
        //     .should('be.visible')
        //     .should('not.be.disabled')
        //     .click()

        cy.contains('button', /Add(New Product)?/i)
            .then(($btn) => {
                expect($btn).to.have.length(1);
                expect($btn).to.have.prop('tagName', 'BUTTON');
            });
        cy.contains('button', /Add(New Product)?/i).click();

        // Inserting Values into Add New Product Dialog Box
        // Step 1: Checking the dialog is open
        cy.get('div[role="dialog"]')
            // .should('be.visible');
        cy.contains('h2', 'Add New Product')
            .should('be.visible');

        // Step 2: Selecting Category
        cy.get('button[role="combobox"]')
            .contains('Select Category')
            .click({ force: true });
        // Waiting for dropdown to appear and selecting the first available option
        cy.get('[role="option"]').first().click();


        // Step 3: Filling the Product Name input
        cy.get('input#itemName')
        .should('exist')
        .type('My Test Product');

        // Step 4: Selecting Unit (Click and choose first option)
        cy.get('div')
        .contains('Select Unit')
        .click();

        cy.get('[role="option"]').first().click();

        // Step 5: Ensure the visibility and presence of Cancel Button
        cy.contains('button', 'Cancel')
        .should('exist')
        .should('not.be.disabled')
        // .click();

        // Step 6: Ensure Submit is now enabled and click it
        cy.contains('button', 'Submit')
        .should('not.be.disabled')
        .click();

        cy.contains('Item Created')
            .should('exist')
            .and('be.visible');

    });

});