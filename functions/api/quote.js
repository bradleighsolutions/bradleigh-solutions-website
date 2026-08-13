// Cloudflare Pages Function
// Lives at: functions/api/quote.js in the repo
// Handles POST requests sent to: /api/quote
//
// What it does, step by step:
//  1. Confirms the Turnstile check was real (not a bot)
//  2. Confirms the required form fields were actually filled in
//  3. Figures out who the email should go to (info@ always, plus a
//     partner contact if the submission came through a partner link)
//  4. Sends the email through Resend
//
// Needs two private settings added in Cloudflare Pages > Settings > Environment Variables:
//   RESEND_API_KEY        (from resend.com > API Keys)
//   TURNSTILE_SECRET_KEY   (from the Cloudflare Turnstile widget, the secret one, not the site key)

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();

    // 1. Verify the Turnstile token before doing anything else
    const token = data['cf-turnstile-response'];
    if (!token) {
      return jsonResponse({ success: false, error: 'Missing verification token.' }, 400);
    }

    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || ''
      })
    });
    const verifyResult = await verify.json();

    if (!verifyResult.success) {
      return jsonResponse({ success: false, error: 'Verification failed. Please try again.' }, 403);
    }

    // 2. Confirm required fields are present
    const required = [
      'firstName', 'lastName', 'email', 'numVehicles', 'shipmentType',
      'pickupLocation', 'pickupCountry', 'deliveryLocation', 'deliveryCountry'
    ];
    for (const field of required) {
      if (!data[field] || !String(data[field]).trim()) {
        return jsonResponse({ success: false, error: 'Please fill in all required fields.' }, 400);
      }
    }

    // 3. Partner routing list
    // Add a new partner here any time you sign one on. That's the only
    // change needed, no new pages, no new code elsewhere.
    const partners = {
      'direct-auction': { name: 'Direct Auction', email: '' } // TODO: add Amanda Booth's email once you have it
    };

    const recipients = ['info@bradleighsolutions.com'];
    let partnerLabel = '';
    if (data.ref && partners[data.ref]) {
      partnerLabel = ' (via ' + partners[data.ref].name + ')';
      if (partners[data.ref].email) {
        recipients.push(partners[data.ref].email);
      }
    }

    // 4. Build the email
    const name = `${data.firstName} ${data.lastName}`;
    const bodyText = [
      `QUOTE REQUEST${partnerLabel}`,
      '====================',
      '',
      `NAME: ${name}`,
      `EMAIL: ${data.email}`,
      `PHONE: ${data.phone || 'Not provided'}`,
      `CUSTOMER TYPE: ${data.customerType || 'Not specified'}`,
      '',
      `NUMBER OF VEHICLES: ${data.numVehicles}`,
      `SHIPMENT TYPE: ${data.shipmentType}`,
      '',
      `PICKUP: ${data.pickupLocation}, ${data.pickupCountry}`,
      `DELIVERY: ${data.deliveryLocation}, ${data.deliveryCountry}`,
      `PREFERRED DATE: ${data.pickupDate || 'Flexible'}`,
      '',
      `NOTES: ${data.notes || 'None'}`
    ].join('\n');

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'BradLeigh Solutions Website <quotes@send.bradleighsolutions.com>',
        to: recipients,
        reply_to: data.email,
        subject: `Quote Request from ${name}${partnerLabel}`,
        text: bodyText
      })
    });

    if (!emailResponse.ok) {
      return jsonResponse({ success: false, error: 'Could not send email right now.' }, 502);
    }

    // 5. Send a confirmation email back to the customer
    // If this one fails for some reason, we don't want it to block the
    // success response, your team already got their copy above.
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'BradLeigh Solutions <quotes@send.bradleighsolutions.com>',
          to: [data.email],
          reply_to: 'info@bradleighsolutions.com',
          subject: 'We received your quote request',
          text: [
            `Hi ${data.firstName},`,
            '',
            'Thanks for reaching out to BradLeigh Solutions. We have received your quote request and one of our team members will be in touch within 1 business day.',
            '',
            'Here is a copy of what you submitted:',
            `Pickup: ${data.pickupLocation}, ${data.pickupCountry}`,
            `Delivery: ${data.deliveryLocation}, ${data.deliveryCountry}`,
            `Number of vehicles: ${data.numVehicles}`,
            '',
            'If you have any questions in the meantime, feel free to call us at 1-877-232-7235.',
            '',
            'BradLeigh Solutions Ltd.'
          ].join('\n')
        })
      });
    } catch (confirmErr) {
      // Silently ignore, the main notification already succeeded
    }

    return jsonResponse({ success: true }, 200);

  } catch (err) {
    return jsonResponse({ success: false, error: 'Something went wrong on our end.' }, 500);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
