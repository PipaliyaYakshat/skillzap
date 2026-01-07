import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      pool: true,
      auth: {
        user: 'pipaliyayakshat@gmail.com',
        pass: 'ytjx exfu jnny ouyp',
      },
    });
  }

  //   async sendOtpEmail(to: string, username: string, otp: number) {
  //     const mailOptions = {
  //       from: 'pipaliyayakshat@gmail.com',
  //       to,
  //       subject: 'Your One-Time Password (OTP) for Password Reset',
  //       text: `Dear ${username},

  // We received a request to reset your password. Please use the following One-Time Password (OTP) to proceed:

  // OTP: ${otp}

  // This OTP is valid for 2 minutes. For security reasons, do not share this code with anyone.

  // If you did not request this password reset, please contact our support team immediately at support@example.com.

  // Best regards,
  // Your Company Team`,
  //     };

  //     try {
  //       return await this.transporter.sendMail(mailOptions);
  //     } catch (error) {
  //       throw new HttpException(
  //         error.message,
  //         error.status || HttpStatus.INTERNAL_SERVER_ERROR,
  //       );
  //     }
  //   }

  async sendOtpEmail(to: string, username: string, otp: number) {
    const otpString = otp.toString().split('');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Password Reset OTP</title>
</head>

<body style="margin:0;padding:0;font-family:Nunito Sans,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="center">

<table width="100%" style="max-width:600px;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
  
  <!-- HEADER -->
  <tr>
    <td style="padding:30px;text-align:center;background:#F6F5F8">
      <img src="https://skillzap.s3.eu-north-1.amazonaws.com/logo+(2).png" width="70" />
      <h2 style="margin:10px 0;color:#010030;">SkillZap AI</h2>
      <p style="margin:0;color:#555;">Password Reset</p>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="padding:40px;">
      <h3>Hi ${username}, 👋</h3>
      <p>We received a request to reset your password.</p>
      <p>Please use the OTP below to proceed:</p>

      <!-- OTP BOX -->
      <div style="text-align:center;margin:30px 0;">
        ${otpString
          .map(
            (digit) => `
            <span style="
              display:inline-block;
              width:50px;
              height:60px;
              line-height:60px;
              margin:0 4px;
              background:#f0f7ff;
              border-radius:8px;
              font-size:28px;
              font-weight:700;
              color:#2d3748;">
              ${digit}
            </span>
          `,
          )
          .join('')}
      </div>

      <p style="text-align:center;">
        This OTP is valid for <b>2 minutes</b>.
      </p>

      <p style="color:#666;">
        Do not share this code with anyone.
      </p>

      <p>— SkillZap AI Team</p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#f8f9fa;padding:20px;text-align:center;font-size:14px;color:#777;">
      © 2025 SkillZap AI. All rights reserved.
    </td>
  </tr>

</table>

</td>
</tr>
</table>
</body>
</html>
`;

    try {
      return await this.transporter.sendMail({
        from: 'SkillZap AI <pipaliyayakshat@gmail.com>',
        to,
        subject: 'Password Reset OTP – SkillZap AI',
        html,
      });
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendEnterpriseRegistrationEmail(registrationData: {
    firstName: string;
    lastName: string;
    email: string;
    contactNumber: string;
    organizationName: string;
    city: string;
    country: string;
    aboutUs: string;
    countryCode?: string;
  }) {
    const mailOptions = {
      from: registrationData.email,
      to: 'pipaliyayakshat@gmail.com',
      subject: 'New Enterprise User Registration Request',
      text: `A new enterprise user has registered with the following details:

First Name: ${registrationData.firstName}
Last Name: ${registrationData.lastName}
Email: ${registrationData.email}
Contact Number: ${registrationData.contactNumber}
Country Code: ${registrationData.countryCode || 'N/A'}
Organization Name: ${registrationData.organizationName}
City: ${registrationData.city}
Country: ${registrationData.country}
About Us: ${registrationData.aboutUs}

User Type: Super Admin

Please review this registration request.

Best regards,
Skillzap System`,
    };

    try {
      return await this.transporter.sendMail(mailOptions);
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  //   async sendEnterpriseApprovalEmail(
  //     email: string,
  //     firstName: string,
  //     lastName: string,
  //   ) {
  //     const mailOptions = {
  //       from: 'pipaliyayakshat@gmail.com',
  //       to: email,
  //       subject: 'Your Enterprise Account Has Been Approved',
  //       text: `Dear ${firstName} ${lastName},

  // Congratulations! Your enterprise user registration has been approved.

  // You can now login to your account using the following credentials:

  // Email: ${email}
  // Password: Pass@123

  // Please login and change your password after your first login for security purposes.

  // Best regards,
  // Skillzap Team`,
  //     };

  //     try {
  //       return await this.transporter.sendMail(mailOptions);
  //     } catch (error) {
  //       throw new HttpException(
  //         error.message,
  //         error.status || HttpStatus.INTERNAL_SERVER_ERROR,
  //       );
  //     }
  //   }

  async sendEnterpriseApprovalEmail(
    email: string,
    firstName: string,
    lastName: string,
    companyName: string,
  ) {
    const tempPassword = 'Pass@123';
    const fullName = `${firstName} ${lastName}`;

    const mailOptions = {
      from: '"SkillZap AI" <pipaliyayakshat@gmail.com>',
      to: email,
      subject: 'Your Enterprise Account Has Been Approved',
      text: `Dear ${fullName},

Congratulations! Your Skillzap Enterprise account has been approved for ${companyName}.

Login details:
Email: ${email}
Password: ${tempPassword}
Login URL: http://localhost:3000/

Please change your password after first login.

Best regards,
Skillzap Team`,

      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>Enterprise Admin Approval</title>
  <style>
    @media only screen and (max-width: 600px) {
      .main-content>td { padding: 40px 15px !important; }
      .credentials-box { padding: 15px !important; }
    }
  </style>
</head>

<body style="margin:0;padding:0;font-family:Nunito Sans,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="center" style="padding:20px">

<table width="100%" style="max-width:600px;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.1)">

<tr>
<td style="background:#F6F5F8;padding:30px;text-align:center;border-radius:12px 12px 0 0">
  <img src="https://skillzap.s3.eu-north-1.amazonaws.com/logo+(2).png" width="70" />
  <h1 style="margin:10px 0 0;color:#010030">SkillZap AI</h1>
  <p>Your Smart Learning Companion</p>
</td>
</tr>

<tr class="main-content">
<td style="padding:40px 25px">

<h2>Welcome to Skillzap Enterprise!</h2>

<p>Dear ${fullName},</p>

<p>
Congratulations! Your Skillzap Enterprise account has been approved for
<strong>${companyName}</strong>.
</p>

<table width="100%" style="margin:30px 0">
<tr>
<td class="credentials-box" style="background:#f5f5f5;padding:20px;border-radius:8px">
  <h3>Your Login Credentials</h3>
  <p><strong>Email:</strong> ${email}</p>
  <p><strong>Password:</strong> ${tempPassword}</p>
  <p>
    <strong>Login URL:</strong>
    <a href="http://localhost:3000/">http://localhost:3000/</a>
  </p>
</td>
</tr>
</table>

<p>Please log in and change your password immediately for security purposes.</p>

<p>Best regards,<br/>The Skillzap Team</p>

</td>
</tr>

<tr>
<td style="background:#f8f9fa;padding:30px;text-align:center;border-radius:0 0 12px 12px">
<p style="font-size:14px">© 2025 SkillZap AI. All rights reserved.</p>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>
`,
    };

    try {
      return await this.transporter.sendMail(mailOptions);
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendRegisteringEmail(to: string, username: string, otp: number) {
    const otpString = otp.toString().split('');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>OTP Verification</title>
</head>

<body style="margin:0;padding:0;font-family:Nunito Sans,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="center">

<table width="100%" style="max-width:600px;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
  
  <!-- HEADER -->
  <tr>
    <td style="padding:30px;text-align:center;background:#F6F5F8">
      <img src="https://skillzap.s3.eu-north-1.amazonaws.com/logo+(2).png" width="70" />
      <h2 style="margin:10px 0;color:#010030;">SkillZap AI</h2>
      <p style="margin:0;color:#555;">Email Verification</p>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="padding:40px;">
      <h3>Hi ${username}, 👋</h3>
      <p>Thank you for registering with <b>SkillZap AI</b>.</p>
      <p>Please use the OTP below to verify your email:</p>

      <!-- OTP BOX -->
      <div style="text-align:center;margin:30px 0;">
        ${otpString
          .map(
            (digit) => `
            <span style="
              display:inline-block;
              width:50px;
              height:60px;
              line-height:60px;
              margin:0 4px;
              background:#f0f7ff;
              border-radius:8px;
              font-size:28px;
              font-weight:700;
              color:#2d3748;">
              ${digit}
            </span>
          `,
          )
          .join('')}
      </div>

      <p style="text-align:center;">
        This OTP is valid for <b>2 minutes</b>.
      </p>

      <p style="color:#666;">
        Do not share this code with anyone.
      </p>

      <p>— SkillZap AI Team</p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#f8f9fa;padding:20px;text-align:center;font-size:14px;color:#777;">
      © 2025 SkillZap AI. All rights reserved.
    </td>
  </tr>

</table>

</td>
</tr>
</table>
</body>
</html>
`;

    try {
      return await this.transporter.sendMail({
        from: 'SkillZap AI <pipaliyayakshat@gmail.com>',
        to,
        subject: 'Verify Your Email – SkillZap AI',
        html,
      });
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
