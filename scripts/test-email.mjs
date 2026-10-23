import nodemailer from 'nodemailer';

async function main() {
  console.log('Iniciando prueba de conexión SMTP con Gmail...');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  try {
    // 1. Validar autenticación con los servidores de Google
    await transporter.verify();
    console.log('✔ Autenticación con Gmail SMTP exitosa.');

    // 2. Enviar correo de prueba a su propia cuenta
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_USER,
      subject: 'Prueba de servicio - BuildMeAPP',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #059669;">¡Conexión establecida con éxito!</h2>
          <p>El servicio de correo mediante <strong>Nodemailer</strong> y <strong>Gmail SMTP</strong> está plenamente operativo en BuildMeAPP.</p>
          <p style="color: #64748b; font-size: 13px;">Listo para integrar el envío de enlaces de recuperación de contraseña.</p>
        </div>
      `,
    });

    console.log(`✔ Correo enviado satisfactoriamente.`);
    console.log(`ID del mensaje: ${info.messageId}`);
  } catch (error) {
    console.error('✖ Error durante la conexión o el envío:', error);
  }
}

main();