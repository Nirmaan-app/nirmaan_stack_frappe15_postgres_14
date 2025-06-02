/// <reference types="Cypress" />

const email = Cypress.env('login_Email');
const password = Cypress.env('login_Password');

describe('Adding a New PR', () => {

    beforeEach( () => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(email);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(password);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Navigates to Procurement requests page and adds a Normal PR', () => {

        cy.get('[data-cy="procurement-requests-button"]').should('be.visible').click();
        cy.get('[data-cy="procurement-requests-search-bar"]').should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created On').should('be.visible');
        });

        cy.contains('Add New PR').should('be.visible').click();
        cy.get('.css-art2ul-ValueContainer2').click();
        // cy.get('.css-1nmdiq5-menu').should('be.visible');
        cy.get('.css-1nmdiq5-menu')
        .find('[role="option"]')
        .then( $options => {
            const randomIndex = Math.floor( Math.random() * $options.length);
            const selectedOption = $options[randomIndex].textContent;
            cy.log(`Randomly Selected Option: ${selectedOption}`);
            cy.wrap($options[randomIndex]).click();
        });

        cy.get('[data-cy="add-new-pr-normal-custom-button"]').should('be.visible').click();
        cy.get('[data-cy="add-new-pr-normal"]').should('exist').click();

        cy.get('.rounded-xl.bg-card', { timeout: 10000 }) 
        /**  .should('have.length.gt', 0) */ 
        .then(($cards) => {
            const randomIndex = Math.floor(Math.random() * $cards.length);
            const selectedCard = $cards[randomIndex].textContent;
            cy.log(`Selected Work Package -> ${selectedCard}`)               
            cy.wrap($cards[randomIndex]).click();
        });

        function executeTestFlow(iteration) {

            cy.log(`Starting Test Iteration ${iteration}`);

            // Opening Dropdown to Select required Item
            cy.get('.css-b62m3t-container .css-1xc3v61-indicatorContainer', { timeout: 10000 })
            .should('be.visible')
            .click();

            // // Wait for dropdown menu to appear and select random option
            // cy.get('.css-1nmdiq5-menu', { timeout: 10000 })
            // .should('be.visible')
            // .then(($options) => {
            //     const randomIndex = Math.floor(Math.random() * $options.length);
            //     const randomItem = $options[randomIndex].textContent;
            //     cy.log(`Randomly Selected Item...... : ${randomItem}`)
            //     cy.wrap($options[randomIndex])
            //         // .should('be.visible')
            //         .click();
            // });

            // Enhanced Approach ->
            cy.get('.css-1nmdiq5-menu [role="option"]', { timeout: 10000 })
            .should('have.length.greaterThan', 0)
            .then(($options) => {
                const randomIndex = Math.floor(Math.random() * $options.length);
                const randomItem = $options[randomIndex].textContent?.trim();
                cy.log(`Randomly Selected Item...... : ${randomItem}`);
                cy.wrap($options[randomIndex]).click();
            });

            // Open dropdown for Selecting Make
            cy.get('.css-b62m3t-container .css-1xc3v61-indicatorContainer', { timeout: 10000 })
            .should('be.visible')
            .click();

            // Try to find and click "Local Make" (with fallback to first option)
            cy.get('body').then(($body) => {
            if ($body.find(':contains("Local Make")').length > 0) {
            cy.contains('.css-1nmdiq5-menu [role="option"]', 'Local Make')
                .should('be.visible')
                .click();
            } else {
            // Fallback to first option
            cy.get('.css-1nmdiq5-menu [role="option"]')
                .first()
                .click();
            }

            
            });

            cy.get('#quantity-input')
                .should('exist')
                .and('be.visible')
                .and('not.be.disabled');

            // Generate random number between 1-9 and type it
            const randomNum = Math.floor(Math.random() * 9) + 1;
            cy.get('#quantity-input')
                .should('be.visible')
                .clear()
                .type(randomNum.toString())
                    .then(() => {
                        cy.log(`Entered random quantity: ${randomNum}`);
                    });

            // Array of possible PR item comments
            const itemComments = [
                "Please ensure this meets the project specifications before approval.",
                "Double-check the measurements against the technical drawings.",
                "This item requires additional safety certifications - please verify.",
                "Confirm lead time with vendor before proceeding with this item.",
                "Need clarification on the material grade for this component.",
                "This matches our quality standards - ready for procurement."
            ];
    
            // Function to add random comment
            // const addRandomComment = () => {
            //     // Get random comment from array
            //     const randomComment = itemComments[Math.floor(Math.random() * itemComments.length)];
                
            //     // Typeing comment into the input box
            //     cy.get('#comment-input')
            //     .should('be.visible')
            //     .clear()
            //     .type(randomComment, { delay: 30 });
            // };
            // addRandomComment();

            // Select and type a random comment
            cy.get('#comment-input')
            .should('be.visible')
            .clear()
            .type(itemComments[Math.floor(Math.random() * itemComments.length)])
            .then(($input) => {
            cy.log(`Entered comment: "${$input.val()}"`); 
            });

            cy.contains('button', 'Add to Cart')
            .scrollIntoView()
            .should('have.class', 'bg-background')
            .and('be.visible')
            // .and('be.disabled')
            .click();
            }


        // Execute 2-3 times
        [1, 2, 3].forEach((iteration) => {
            executeTestFlow(iteration);
          });
  
          // Clicking Submit button after adding the Required Items ->
          cy.contains('button', /Submit Request/i)
          .scrollIntoView()
          .should('have.attr', 'aria-haspopup', 'dialog')
          .and('be.visible')
          .click();

          // 1. Targetting by placeholder + classes (most stable)
        cy.get('textarea[placeholder="Add final comments (optional)..."]')
        .should('be.visible')
        .type('This is my test comment');

        cy.contains('button', /^Cancel$/i)  // Exact match, case-insensitive
        .should('have.class', 'bg-background')
        .and('have.attr', 'type', 'button')
        .and('be.visible')
        // .click();

        cy.get('button svg.lucide-check-check')
        .parent('button')
        .should('contain', 'Confirm')
        .and('be.visible')
        .click();
        
        cy.wait(6000);

        });


        // Adding New Custom PR Test 
        it('Navigates to Procurement requests page and adds a Custom PR', () => {

            cy.get('[data-cy="procurement-requests-button"]').should('be.visible').click();
            cy.get('[data-cy="procurement-requests-search-bar"]').should('be.visible');
            cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
                cy.get('thead').should('exist');
                cy.get('tbody tr').should('have.length.at.least', 1);
                cy.contains('th', '#PR').should('be.visible');
                cy.contains('th', 'Created On').should('be.visible');
            });
    
            cy.contains('Add New PR').should('be.visible').click();
            cy.get('.css-art2ul-ValueContainer2').click();
            // cy.get('.css-1nmdiq5-menu').should('be.visible');
            cy.get('.css-1nmdiq5-menu', { timeout: 9000})
            .find('[role="option"]')
            .then( $options => {
                const randomIndex = Math.floor( Math.random() * $options.length);
                const selectedOption = $options[randomIndex].textContent;
                cy.log(`Randomly Selected Option: ${selectedOption}`);
                cy.wrap($options[randomIndex]).click();
            });
    
            cy.get('[data-cy="add-new-pr-normal-custom-button"]').should('be.visible').click();
            cy.get('[data-cy="add-new-pr-custom"]').should('exist').click();

            cy.get('.css-w9q2zk-Input2')
            .should('exist')
            .and('be.visible')
            .click();

            // Selecting Random Vendor
            cy.get('#react-select-9-listbox', { timeout: 10000 })
            // .should('be.visible')
            .find('[role="option"]') // Standard for react-select options
            .should('have.length.gt', 0)
            .then(($options) => {
                const randomIndex = Math.floor(Math.random() * $options.length);
                const randomOption = $options[randomIndex];
                const selectedVendor = randomOption.textContent?.trim();

                cy.log(`Randomly selected vendor: ${selectedVendor}`);

                cy.wrap(randomOption).click();
            });

            // New Item Button
            cy.contains('button', 'New Item')
            .should('have.class', 'bg-primary')
            .and('have.class', 'text-primary-foreground')
            .click();

            // selecting Procurem,ent Package
            // // 1. Open the dropdown
            // cy.get('[role="combobox"]').last()
            // // .scrollIntoView()
            // .should('have.attr', 'aria-expanded', 'false')
            // .click()
            // .should('have.attr', 'aria-expanded', 'true');

            // // 2. Select random option
            // cy.get('[role="listbox"] [role="option"]')
            // .should('have.length.gt', 0)
            // .then(($options) => {
            // const randomIndex = Math.floor(Math.random() * $options.length);
            // const selectedText = $options[randomIndex].textContent.trim();
            // cy.wrap($options[randomIndex])
            //     .click()
            //     .log(`Selected Package: ${selectedText}`);
            
            // // 3. Verify selection updated the combobox
            // cy.get('[role="combobox"]')
            //     .should('contain', selectedText);
            // });

            // 1. Open dropdown
            cy.get('.border-b > :nth-child(1) > .flex')
            .should('have.attr', 'aria-expanded', 'false')
            .click({ force: true }) // Force click if needed
            .should('have.attr', 'aria-expanded', 'true');

            // 2. Target OPTIONS correctly (not combobox)
            cy.get('[role="listbox"] [role="option"]', { timeout: 10000 }) // Wait longer
            .should('have.length.gt', 0)
            .then(($options) => {
            const randomIndex = Math.floor(Math.random() * $options.length);
            const option = $options[randomIndex];
            const optionText = option.textContent.trim();
            
            // 3. Scroll into view and click with retry
            cy.wrap(option)
                .scrollIntoView()
                .should('be.visible')
                .click({ force: true });
            
            cy.log(`Selected: ${optionText}`);
            
            // 4. Verify selection
            cy.get('.border-b > :nth-child(1) > .flex')
                .should('contain', optionText);
            });

            // Open the dropdown to select Category
            // 1. Verify dropdown state
            cy.get('[data-cy="category-dropdown"]')
            .should('be.visible')
            .and('have.attr', 'data-state', 'closed')
            // .and('be.disabled');

            cy.get('[data-cy="category-dropdown"]')
            .scrollIntoView()
            .should('not.be.disabled')
            .click()
            .should('have.attr', 'aria-expanded', 'true');

            cy.get('[role="listbox"] [role="option"]:not([disabled])')
            .first()
            .then(($option) => {
                const categoryName = $option.text().trim();
                cy.wrap($option)
                .click()
                .log(`Selected category: ${categoryName}`);
                
                // 5. Verify selection
                cy.get('[data-cy="category-dropdown"]')
                .should('contain', categoryName);
            });

            // cy.get('[data-cy="category-dropdown"]')
            //     .click();
            
            // Typing Item Name/Description
            // Array of Item Name/Description descriptions
            const itemDescriptions = [
            "Stainless steel fasteners, grade 304, with corrosion-resistant coating",
            "Electrical conduits - 25mm diameter, PVC-coated, 10m length",
            "HVAC ducting components - pre-insulated, 500mm width",
            "Structural steel beams - ASTM A36, 6m standard length",
            "Safety signage - bilingual (English/Spanish), reflective surface",
            "Concrete reinforcement bars - 12mm diameter, 6m sections"
            ];

            // Select and type a random description
            cy.get('[data-cy="item-name-description"]')
            .should('be.visible')
            .clear()
            .type(itemDescriptions[Math.floor(Math.random() * itemDescriptions.length)])
            .then(($textarea) => {
                const enteredText = $textarea.val();
                cy.log(`Entered item description: "${enteredText}"`);
                
                // Optional: Verify the text was properly entered
                cy.wrap($textarea)
                .should('have.value', enteredText);
            });

            // Selecting Unit form the Dropdown 
            cy.get('.border-b > :nth-child(4) > .flex')
            .scrollIntoView()
            .click();

            cy.get('[role="option"]')
            .should('have.length.gt', 0)
            .then(($options) => {
                const randomIndex = Math.floor(Math.random() * $options.length);
                cy.wrap($options[randomIndex]).click();
            });

            // Putting random Quantity in the Quantity Input field
            const randomQuantity = Math.floor(Math.random() * ( 16 - 3 + 1)) + 3;
            cy.get('[data-cy="quantity"]')
            .scrollIntoView()
            .clear()
            .type(`${randomQuantity}`);

            // Selecting the Tax 
            cy.get('[data-cy="tax"]')
            .scrollIntoView()
            .click();
            const taxOptions = ['5 %', '12 %', '18 %', '28 %'];
            const randomIndex = Math.floor(Math.random() * taxOptions.length);
            const randomTax = taxOptions[randomIndex];

            cy.contains('div', randomTax).click();

            // Putting the Quote Price in the Quote input filed 
            const randomQuote = Math.floor(Math.random() * ( 123 - 36 + 1)) + 36;
            cy.get('[data-cy="quote"]')
            .scrollIntoView()
            .clear()
            .type(`${randomQuote}`);

            // Clicking Custom PR Next Button
            cy.get('[data-cy="custom-pr-next-button"]')
            .scrollIntoView()
            .should('be.visible')
            .and('not.be.disabled')
            .click();

            // Fetching nad Clicking the Send For approval Button
            cy.get('[data-cy="custom-pr-send-for-approval-button"]')
            .scrollIntoView()
            .should('be.visible')
            .and('not.be.disabled')
            .click();

            // Fetching the comment box and typing the comment
            cy.get('[data-cy="custom-pr-confirmation-comment"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type('This Is a Custom Procurement Request Test Comment......', { delay: 30});

            // Confirmation Box Cancel Button
            cy.get('[data-cy="custom-pr-confirmation-cancel"]')
            .should('exist')
            .and('be.visible')
            // .click();

            // Confirmation Box Confirm Button
            cy.get('[data-cy="custom-pr-confirmation-confirm"]')
            .should('exist')
            .and('be.visible')
            .click();

            cy.wait(6000);

        });
});