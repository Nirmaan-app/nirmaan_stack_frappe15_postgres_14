/// <reference types="Cypress" />

const emailVendorsPage = Cypress.env('login_Email');
const passwordVendorsPage = Cypress.env('login_Password');

describe('Vendors Page Test Flow and Validations', () => {

    // Function to Generate Contact Person Name
    function generateAlphaSuffix(length = 5) {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < length; i++) {
          result += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        return result;
      }
      

    const randomSuffix = Date.now(); // Unique per run
    const vendorName = `Vendor-${randomSuffix}`;
    const contactPerson = `Person-${generateAlphaSuffix()}`;
    const gstNumber = `27ABCDE${Math.floor(1000 + Math.random() * 9000)}Z5Z5`;

    beforeEach(() => {
        // Logging In -
        cy.intercept('POST', '**/api/method/login').as('loginRequest');

        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]', { timeout: 3000}).should('be.visible').type(emailVendorsPage);
        cy.get('[data-cy="username-login-input-password"]', { timeout: 3000}).should('be.visible').type(passwordVendorsPage);
        cy.get('[data-cy="login-button"]', { timeout: 3000}).should('be.visible').click();    

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Navigates to Vendors page and Validates it', () => {

        // Select the Vendors card
        cy.get('[data-cy="admin-dashboard-vendors-card"]')
            .should('exist')
            .and('be.visible');

        // Check href in the anchor tag
        cy.get('[data-cy="admin-dashboard-vendors-card"] a')
            .should('have.attr', 'href', '/vendors');

        // Validate heading text
        cy.get('[data-cy="admin-dashboard-vendors-card"] h3')
            .should('contain.text', 'Vendors');

        // Validate presence of the lucide package icon (SVG)
        cy.get('[data-cy="admin-dashboard-vendors-card"] svg')
            .should('be.visible')
            .and('have.class', 'lucide-package');

        // Validate the Vendors count and present
        cy.get('[data-cy="admin-dashboard-vendors-card"] .text-2xl.font-bold')
            .should('be.visible')
            .should(($el) => {
                const text = $el.text().trimEnd();
                expect(text.length, 'Text should Not be empty').to.be.greaterThan(0);
            })
            .invoke('text')
            .then((text) => {
                cy.log(`Vendors car number: "${text}"`);
                const cleanedText = text.replace(/[^\d]/g, '');
                expect(cleanedText.length, `Expected a digit in "${text}"`).to.be.greaterThan(0);
                const count = parseInt(cleanedText, 10);
                expect(count).to.be.a('number');
                expect(count).to.be.greaterThan(0);
            });

        });


        it('Navigates to Vendors Page, checks availability and Add a New vendor', () => {

            // Navigating to Products Page
            cy.get('[data-cy="admin-dashboard-vendors-card"]', { timeout: 6000 })
                .should('exist')
                .and('be.visible')
                // .click();
            cy.get('[data-cy="admin-dashboard-vendors-card"]').click();

            // Asserting that the "Total Products" card is present and contains expected text
            cy.contains('h3', 'Total Registered Vendors')
                .should('be.visible')
                .closest('div.rounded-xl.border')
                .within(() => {
                    // Waiting for a moment if the text might render asynchronously
                    cy.get('.text-2xl.font-bold', { timeout: 10000 })
                        .should('exist')
                        .invoke('text')
                            .then((text) => {
                                cy.log(`Total Vendors Count: "${text.trim()}"`);
                                const cleaned = text.replace(/[^\d]/g, '');
                                // expect(cleaned.length, 'Should contain at least one digit').to.be.greaterThan(0);
                                const count = parseInt(cleaned, 10);
                                expect(count, 'Parsed count').to.be.a('number');
                                // expect(count).to.be.greaterThan(0);
                    });
            });

        cy.url().should('include', '/vendors');
        cy.contains('Total Registered Vendors').should('exist');

        cy.contains('button', /Add(New Vendor)?/i)
            .then(($btn) => {
                expect($btn).to.have.length(1)
                expect($btn).to.have.prop('tagName', 'BUTTON');
            })
        cy.contains('button', /Add(New Vendor)?/i).click();

        // Select Vendor Type
        cy.contains('Vendor_Type')
            .parent()
            .find('button')
            .click();   
        cy.contains('Material & Service')
            .click()

        cy.wait(600);

        const vendorNames = [
            "Apex Traders",
            "BrightMart Supplies",
            "CraftEdge Solutions",
            "Delta Distributors",
            "EverGreen Vendors",
            "FusionMart",
            "GlobalTech Supplies",
            "HighPoint Merchants",
            "Indigo Retailers",
            "Jupiter Goods Co.",
            "Krypton Supplies",
            "Lotus Mart",
            "Metro Wholesale",
            "Nova Line Distributors",
            "OmniTrade Hub",
            "Prime Source Inc.",
            "QuickSupply Depot",
            "Reliant Distributors",
            "Sunrise Traders",
            "Trendy Mart Pvt. Ltd.",
            "Unity Distributions",
            "Vertex Supplies",
            "Westend Partners",
            "Xpress Supply Co.",
            "YellowStone Vendors",
            "Zenith Merchandise"
          ];

        const randomIndex = Math.floor(Math.random() * vendorNames.length) + 1;
        const randomVendor = vendorNames[randomIndex];

        // Fill Vendor Shop Name
        cy.get('input[name="vendor_name"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(vendorName);

        // Fill Contact Person
        cy.get('input[name="vendor_contact_person_name"]')
          .should('exist')
          .and('be.visible')
          .clear()
          .type(contactPerson);

        // Selecting Taxation Type
        cy.contains('Taxation Type')
            .parent()
            .find('button')
            .click();
        cy.contains('GST')
            .click({force: true});

        // Fill GST Number
        cy.get('input[name="vendor_gst"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(gstNumber);


        // Select Category From the Dropdown

        // cy.get('.css-13cymwt-control').click();
        // // Select 6 from all available options
        // const randomNumber = Math.floor(Math.random() * 6) + 1;
        // for(let i = 0; i < randomNumber; i++){
        //     cy.get('.css-1nmdiq5-menu div')
        //     .eq(i)
        //     .click();

        //     // Reopening Dropdown as it closes after selection
        //     cy.get('.css-13cymwt-control')
        //         .click();
        // }

        const randomNumber = Math.floor(Math.random() * 7) + 1;

        function selectDropdownItems(count, selected = 0) {
            if (selected >= count) return;
          
            // Open the dropdown
            cy.get('.css-13cymwt-control', { timeout: 3000 }).click();
          
            // Wait for the menu to appear and be visible
            cy.get('.css-1nmdiq5-menu div', { timeout: 10000 })
              .should('be.visible')
              .eq(0)
              .click()
              .then(() => {
                // cy.wait(200);
                selectDropdownItems(count, selected + 1);
              });
          }     

        // Calling the function to Select/Add Random Number of Categories
        selectDropdownItems( /** randomNumber */ 1);


        // Vendor Address Details Section ------>

        // Arrays for Random Addresses
        const randomAddressLine1 = [
            "Apt 304, Skyline Towers",
            "Flat 5B, Rosewood Residency",
            "B-17, Lotus Heights",
            "3rd Floor, Krishna Plaza",
            "101, Ocean View Building"
        ];

        const randomAddressLine2 = [
            "MG Road, Sector 42",
            "Baner Main Road, Near Cafe Coffee Day",
            "Whitefield, Behind Tech Park",
            "Hadapsar, Opp. Seasons Mall",
            "Rajouri Garden, Near Metro Station"
        ];

        // Picking a random value
        const addressLine1 = randomAddressLine1[Math.floor(Math.random() * randomAddressLine1.length)];
        const addressLine2 = randomAddressLine2[Math.floor(Math.random() * randomAddressLine2.length)];

        cy.get('input[name="address_line_1"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(addressLine1);

        cy.get('input[name="address_line_2"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(addressLine2);

        // // Vendor City
        // cy.get('input[name="vendor_city"]')
        //     .should('be.visible')
        //     .and('exist')
        //     .type('Bengaluru');

        // // Vendor State
        // cy.get('input[name="vendor_state"]')
        //     .should('be.visible')
        //     .and('exist')
        //     .type('Karnataka');

        // Vendor Pin Code
        const pin = 560033
        cy.get('input[name="pin"]')
            .should('be.visible')
            .and('exist')
            .clear()
            .type('560033');

        // Vendor Mobile Number
        // Generating a random 10-digit phone number
        const phone = `${Math.floor(Math.random() * 3) + 7}${Math.floor(100000000 + Math.random() * 900000000)}`;

        // Generating a random E-mail Address
        const randomId = Math.random().toString(36).substring(2, 8);
        const email = `user_${randomId}@testexample.com`;

        // Type into the Vendor Mobile input 
        cy.get('input[name="vendor_mobile"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(phone); 
            
        // type into Vendor E-mail input
        cy.get('input[name="vendor_email"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(email);

        
        // Vendor Bank Details Section ------>

        // Generate realistic and unique values
        const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
        const accountName = `Test User ${randomSuffix}`;
        const accountNumber = `${Math.floor(100000000000 + Math.random() * 100000000000)}`;
        const ifsc = `SBIN000${Math.floor(1000 + Math.random() * 9000)}`;

        // Vendor Account Name
        cy.get('input[name="account_name"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(accountName);

        // Vendor Account Number
        cy.get('input[name="account_number"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(accountNumber)

        // Confirm Account Number
        cy.get('input[name="confirm_account_number"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(accountNumber);

        // IFSC Code
        cy.get('input[name="ifsc"]')
            .clear()
            .type(ifsc);

        // Bank Name Auto Filled Check
        cy.get('input[name="bank_name"]', { timeout: 10000 })
            .should('not.have.value', '')
            .invoke('val')
            .then(bankName => cy.log(`Auto-Filled Bank Name: ${bankName}`));

        // Bank Branch Auto filled check
        cy.get('input[name="bank_branch"]')
            .should('not.have.value', '')
            .invoke('val')
            .then(branch => cy.log(`Auto-Filled Branch: ${branch}`));

        // Reset/Submit Button Validation
        cy.contains('button', 'Reset')
            .should('exist')
            .and('be.visible')
            // .click();

        cy.contains('button', 'Submit')
            .should('exist')
            .and('be.visible')
            // .click();

        });

});
