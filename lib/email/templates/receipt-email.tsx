import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface ReceiptEmailProps {
  emisor_name: string;
  client_legal_name: string;
  numero_label: string;
  fecha: string;
  total_label: string;
  custom_body: string | null;
}

export function ReceiptEmail({
  emisor_name,
  client_legal_name,
  numero_label,
  fecha,
  total_label,
  custom_body,
}: ReceiptEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Recibo {numero_label} — {emisor_name}
      </Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={h1Style}>{emisor_name}</Heading>
          <Text style={textStyle}>Hola {client_legal_name},</Text>
          {custom_body ? (
            <Text style={textStyle}>{custom_body}</Text>
          ) : (
            <Text style={textStyle}>
              Adjuntamos el recibo {numero_label} por el pago registrado.
              Cualquier consulta, respondé a este mismo email.
            </Text>
          )}
          <Hr style={hrStyle} />
          <Section>
            <Text style={detailStyle}>
              <strong>Recibo:</strong> {numero_label}
            </Text>
            <Text style={detailStyle}>
              <strong>Fecha:</strong> {fecha}
            </Text>
            <Text style={detailStyle}>
              <strong>Total:</strong> {total_label}
            </Text>
          </Section>
          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            Este mensaje fue enviado automáticamente desde nuestro sistema de
            cobranzas.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = {
  backgroundColor: "#f6f6f6",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: 0,
};

const containerStyle = {
  backgroundColor: "#ffffff",
  margin: "32px auto",
  padding: "32px",
  maxWidth: "560px",
  borderRadius: "8px",
  border: "1px solid #e6e6e6",
};

const h1Style = {
  color: "#111111",
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 16px 0",
};

const textStyle = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 12px 0",
};

const detailStyle = {
  color: "#333333",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "4px 0",
};

const hrStyle = {
  borderTop: "1px solid #e6e6e6",
  margin: "20px 0",
};

const footerStyle = {
  color: "#888888",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0",
};
