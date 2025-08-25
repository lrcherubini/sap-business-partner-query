// Importa as bibliotecas necessárias.
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const https = require("https");

/*
{
    "host": "https://sap.company.com.br:8100",
    "auth": {
        "user": "",
        "pass": ""
    },
    "params": {
        "sap-client": "500",
        "sap-language": "PT",
        "$filter": "IsMarkedForArchiving eq false and BusinessPartnerIsBlocked eq false",
        "$select": "BusinessPartner,Customer,Supplier,LastChangeDate,LastChangeTime,LastChangedByUser,BusinessPartnerFullName,IsNaturalPerson,BusinessPartnerIsBlocked,to_Supplier/SupplierProcurementBlock,to_Supplier/to_SupplierPurchasingOrg/PurchasingIsBlockedForSupplier,to_Customer/OrderIsBlockedForCustomer,to_Customer/PostingIsBlocked,BusinessPartnerIsBlocked,to_BusinessPartnerRole/BusinessPartnerRole,to_BusinessPartnerTax/BPTaxType,to_BusinessPartnerTax/BPTaxNumber,to_BusinessPartnerAddress/to_EmailAddress/EmailAddress,OrganizationFoundationDate,to_BusinessPartnerAddress/AddressID,to_BusinessPartnerAddress/StreetName,to_BusinessPartnerAddress/HouseNumber,to_BusinessPartnerAddress/Region,to_BusinessPartnerAddress/HouseNumberSupplementText,to_BusinessPartnerAddress/PostalCode,to_BusinessPartnerAddress/CityCode,to_BusinessPartnerAddress/CityName,to_BusinessPartnerAddress/Country,to_BusinessPartnerAddress/to_FaxNumber/FaxNumber,to_BusinessPartnerAddress/to_PhoneNumber/PhoneNumber,to_BusinessPartnerBank/BankNumber,to_BusinessPartnerBank/BankIdentification,to_BusinessPartnerBank/BankAccount",
        "$expand": "to_Supplier,to_Customer,to_Supplier/to_SupplierPurchasingOrg,to_BusinessPartnerRole,to_BusinessPartnerTax,to_BusinessPartnerAddress,to_BusinessPartnerAddress/to_PhoneNumber,to_BusinessPartnerAddress/to_EmailAddress,to_BusinessPartnerAddress/to_FaxNumber,to_BusinessPartnerBank",
        "$orderby": "BusinessPartner desc"
    },
    "anonymizeFields": [
        "BusinessPartnerFullName",
        "LastChangedByUser",
        "to_BusinessPartnerTax/BPTaxNumber",
        "to_BusinessPartnerAddress/StreetName",
        "to_BusinessPartnerAddress/HouseNumber",
        "to_BusinessPartnerAddress/PostalCode",
        "to_BusinessPartnerAddress/to_EmailAddress/EmailAddress",
        "to_BusinessPartnerAddress/to_FaxNumber/FaxNumber",
        "to_BusinessPartnerAddress/to_PhoneNumber/PhoneNumber",
        "to_BusinessPartnerBank/BankNumber",
        "to_BusinessPartnerBank/BankAccount"
    ],
    "pageSize": 50,
    "maxRecords": 200,
    "outputDir": "business_partners"
}
*/

/**
 * Carrega a configuração de um arquivo JSON externo.
 * @param {string} filePath - O caminho para o arquivo de configuração.
 * @returns {object} O objeto de configuração.
 */
function loadConfig(filePath) {
  try {
    const configFile = fs.readFileSync(filePath, "utf8");
    return JSON.parse(configFile);
  } catch (error) {
    console.error(
      `Erro ao ler ou analisar o arquivo de configuração: ${filePath}`
    );
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * Remove recursivamente a propriedade '__metadata' de um objeto ou array.
 * @param {any} obj - O objeto ou array a ser limpo.
 */
function removeMetadata(obj) {
  if (obj === null || typeof obj !== "object") {
    return;
  }

  if (Array.isArray(obj)) {
    // Se for um array, itera sobre seus elementos.
    obj.forEach((item) => removeMetadata(item));
  } else {
    // Se for um objeto, itera sobre suas chaves.
    for (const key in obj) {
      if (key === "__metadata") {
        delete obj[key];
      } else if (typeof obj[key] === "object") {
        // Se uma propriedade for um objeto ou array, chama a função recursivamente.
        removeMetadata(obj[key]);
      }
    }
    // Caso especial para a propriedade 'results' do OData, que é um array.
    if (obj.results && Array.isArray(obj.results)) {
      removeMetadata(obj.results);
    }
  }
}

/**
 * Anonimiza um valor baseado no seu tipo.
 * @param {any} value - O valor original a ser anonimizado.
 * @param {string} fieldName - O nome do campo, para lógicas específicas (ex: email).
 * @returns {any} O valor anonimizado.
 */
function anonymizeValue(value, fieldName) {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  const fieldLower = fieldName.toLowerCase();

  // Lógica para emails
  if (
    typeof value === "string" &&
    (fieldLower.includes("email") || value.includes("@"))
  ) {
    const randomId = Math.random().toString(36).substring(2, 8);
    return `anon_${randomId}@anonimizado.com`;
  }

  // Lógica para outros tipos de dados
  switch (typeof value) {
    case "string":
      // Verifica se é uma data no formato OData /Date(...)/
      if (value.startsWith("/Date(")) {
        return value; // Mantém datas para não quebrar cenários de teste
      }
      return `ANONIMIZADO_${Math.random().toString(36).substring(2, 10)}`;
    case "number":
      return Math.floor(Math.random() * 900000) + 100000;
    case "boolean":
      return value; // Geralmente não é necessário anonimizar booleanos
    default:
      return `ANONIMIZADO`;
  }
}

/**
 * Navega recursivamente em um objeto e anonimiza os campos especificados.
 * @param {object} obj - O objeto a ser percorrido.
 * @param {string[]} fieldsToAnonymize - Um array de caminhos de campos a serem anonimizados.
 */
function anonymizeObject(obj, fieldsToAnonymize) {
  if (
    !obj ||
    typeof obj !== "object" ||
    !fieldsToAnonymize ||
    fieldsToAnonymize.length === 0
  ) {
    return;
  }

  for (const fieldPath of fieldsToAnonymize) {
    const pathParts = fieldPath.split("/");
    let currentLevel = obj;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];

      if (currentLevel === null || typeof currentLevel[part] === "undefined") {
        break; // Caminho não encontrado no objeto, passa para o próximo
      }

      // Se for a última parte do caminho, anonimiza o valor
      if (i === pathParts.length - 1) {
        currentLevel[part] = anonymizeValue(currentLevel[part], part);
      } else {
        // Navega para o próximo nível
        currentLevel = currentLevel[part];
        // Se o próximo nível for um objeto com 'results' (array OData), itera sobre ele
        if (
          currentLevel &&
          currentLevel.results &&
          Array.isArray(currentLevel.results)
        ) {
          const remainingPath = pathParts.slice(i + 1).join("/");
          for (const item of currentLevel.results) {
            anonymizeObject(item, [remainingPath]);
          }
          // Interrompe a iteração do caminho atual, pois já foi processado recursivamente
          break;
        }
      }
    }
  }
}

/**
 * Função principal para buscar e salvar os Business Partners.
 * @param {object} config - O objeto de configuração carregado.
 */
async function fetchAllBusinessPartners(config) {
  console.log("Iniciando a busca de Business Partners...");

  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
    console.log(`Diretório '${config.outputDir}' criado com sucesso.`);
  }

  let skip = 0;
  let totalCount = 0;
  let effectiveTotal = Infinity; // Define um total efetivo para respeitar o maxRecords
  let hasMoreData = true;

  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  do {
    try {
      const serviceUrl = `${config.host}/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner`;
      const queryParams = new URLSearchParams({
        $format: "json",
        $inlinecount: "allpages",
        $top: config.pageSize,
        $skip: skip,
        ...config.params,
      });

      for (const [key, value] of Object.entries(config.params)) {
        if (!value) queryParams.delete(key);
      }

      const fullUrl = `${serviceUrl}?${queryParams.toString()}`;
      console.log(`\nBuscando dados da URL: ${fullUrl}`);

      const response = await axios.get(fullUrl, {
        httpsAgent,
        auth: { username: config.auth.user, password: config.auth.pass },
        headers: { Accept: "application/json" },
      });

      const data = response.data.d;
      const results = data.results;

      if (skip === 0) {
        totalCount = parseInt(data.__count, 10);
        if (isNaN(totalCount)) {
          console.error(
            "Erro: Não foi possível obter a contagem total de registros."
          );
          break;
        }
        console.log(
          `Total de Business Partners encontrados no servidor: ${totalCount}`
        );

        // Define o total efetivo de registros a serem buscados
        effectiveTotal = totalCount;
        if (
          config.maxRecords &&
          config.maxRecords > 0 &&
          config.maxRecords < totalCount
        ) {
          effectiveTotal = config.maxRecords;
          console.log(
            `Limite máximo de registros a serem processados definido para: ${effectiveTotal}`
          );
        }
      }

      if (results && results.length > 0) {
        console.log(
          `Processando ${results.length} registros (de ${skip + 1} a ${
            skip + results.length
          } de ${effectiveTotal})...`
        );

        for (const partner of results) {
          // 1. REMOVE A TAG __METADATA DE TODOS OS NÍVEIS
          removeMetadata(partner);

          // 2. APLICA A ANONIMIZAÇÃO DOS CAMPOS CONFIGURADOS
          if (config.anonymizeFields && config.anonymizeFields.length > 0) {
            anonymizeObject(partner, config.anonymizeFields);
          }

          const bpId = partner.BusinessPartner;
          const filePath = path.join(config.outputDir, `${bpId}.json`);
          const fileContent = JSON.stringify(partner, null, 4);

          fs.writeFileSync(filePath, fileContent);
          console.log(` -> Arquivo salvo: ${filePath}`);
        }

        skip += results.length;
        // Verifica se deve continuar buscando dados
        if (skip >= effectiveTotal) {
          hasMoreData = false;
        }
      } else {
        hasMoreData = false;
      }
    } catch (error) {
      console.error("\nOcorreu um erro ao buscar os dados:");
      if (error.response) {
        console.error(
          `Status: ${error.response.status} - ${error.response.statusText}`
        );
        console.error("Data:", error.response.data);
      } else if (error.request) {
        console.error("Nenhuma resposta recebida do servidor:", error.request);
      } else {
        console.error("Erro na configuração da requisição:", error.message);
      }
      hasMoreData = false;
    }
  } while (hasMoreData);

  console.log(
    `\nProcesso finalizado. Total de ${
      skip > effectiveTotal ? effectiveTotal : skip
    } registros foram processados.`
  );
}

// --- Ponto de Entrada do Script ---
const configFilePath = process.argv[2];
if (!configFilePath) {
  console.error(
    "Erro: Forneça o caminho para o arquivo de configuração como argumento."
  );
  console.log("Uso: node script.js <caminho_para_config.json>");
  process.exit(1);
}

const config = loadConfig(configFilePath);
fetchAllBusinessPartners(config);
