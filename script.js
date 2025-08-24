// Importa as bibliotecas necessárias.
// 'axios' para fazer requisições HTTP e 'fs' para interagir com o sistema de arquivos.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

/*
* Config.json template
{
    "host": "",
    "auth": {
        "user": "",
        "pass": ""
    },
    "params": {
        "sap-client": "",
        "sap-language": "PT",
        "$filter": "",
        "$select": "",
        "$expand": ""
    },
    "pageSize": 50,
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
        const configFile = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(configFile);
    } catch (error) {
        console.error(`Erro ao ler ou analisar o arquivo de configuração: ${filePath}`);
        console.error(error.message);
        // Encerra o processo se o arquivo de configuração não puder ser lido.
        process.exit(1); 
    }
}

/**
 * Função principal para buscar e salvar os Business Partners.
 * A função é assíncrona para lidar com as requisições de rede.
 * @param {object} config - O objeto de configuração carregado.
 */
async function fetchAllBusinessPartners(config) {
    console.log('Iniciando a busca de Business Partners...');

    // Cria o diretório de saída se ele não existir
    if (!fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir, { recursive: true });
        console.log(`Diretório '${config.outputDir}' criado com sucesso.`);
    }

    let skip = 0; // Contador para a paginação ($skip)
    let totalCount = 0; // Armazena o número total de registros
    let hasMoreData = true; // Flag para controlar o loop de paginação

    // Agente HTTPS para ignorar erros de certificado (comum em ambientes de desenvolvimento)
    // Em produção, configure os certificados corretamente.
    const httpsAgent = new https.Agent({
        rejectUnauthorized: false
    });

    // Loop para buscar os dados em páginas
    do {
        try {
            // Constrói a URL do serviço OData com os parâmetros de paginação e outros
            const serviceUrl = `${config.host}/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner`;
            const queryParams = new URLSearchParams({
                '$format': 'json',
                '$inlinecount': 'allpages',
                '$top': config.pageSize,
                '$skip': skip,
                ...config.params
            });

            // Remove parâmetros vazios para não poluir a URL
            for (const [key, value] of Object.entries(config.params)) {
                if (!value) {
                    queryParams.delete(key);
                }
            }
            
            const fullUrl = `${serviceUrl}?${queryParams.toString()}`;
            console.log(`\nBuscando dados da URL: ${fullUrl}`);

            // Realiza a requisição GET usando axios
            const response = await axios.get(fullUrl, {
                httpsAgent,
                auth: {
                    username: config.auth.user,
                    password: config.auth.pass
                },
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            const data = response.data.d;
            const results = data.results;

            // Na primeira requisição, obtemos o número total de registros
            if (skip === 0) {
                totalCount = parseInt(data.__count, 10);
                if (isNaN(totalCount)) {
                    console.error("Erro: Não foi possível obter a contagem total de registros.");
                    break;
                }
                console.log(`Total de Business Partners encontrados: ${totalCount}`);
            }

            if (results && results.length > 0) {
                console.log(`Processando ${results.length} registros (de ${skip + 1} a ${skip + results.length})...`);
                
                // Itera sobre cada Business Partner retornado na página atual
                for (const partner of results) {
                    const bpId = partner.BusinessPartner;
                    const filePath = path.join(config.outputDir, `${bpId}.json`);
                    
                    // Converte o objeto do parceiro para uma string JSON formatada
                    const fileContent = JSON.stringify(partner, null, 4);
                    
                    // Salva o conteúdo no arquivo JSON
                    fs.writeFileSync(filePath, fileContent);
                    console.log(` -> Arquivo salvo: ${filePath}`);
                }

                // Atualiza o contador de skip para a próxima página
                skip += results.length;

                // Verifica se ainda há dados a serem buscados
                if (skip >= totalCount) {
                    hasMoreData = false;
                }
            } else {
                // Se não houver mais resultados, para o loop
                hasMoreData = false;
            }

        } catch (error) {
            // Tratamento de erros
            console.error('\nOcorreu um erro ao buscar os dados:');
            if (error.response) {
                // O servidor respondeu com um status de erro (4xx, 5xx)
                console.error(`Status: ${error.response.status} - ${error.response.statusText}`);
                console.error('Data:', error.response.data);
            } else if (error.request) {
                // A requisição foi feita, mas não houve resposta
                console.error('Nenhuma resposta recebida do servidor:', error.request);
            } else {
                // Algo aconteceu ao configurar a requisição
                console.error('Erro na configuração da requisição:', error.message);
            }
            hasMoreData = false; // Interrompe o processo em caso de erro
        }
    } while (hasMoreData);

    console.log('\nProcesso finalizado.');
}

// --- Ponto de Entrada do Script ---
// Verifica se o caminho do arquivo de configuração foi passado como argumento
const configFilePath = process.argv[2];
if (!configFilePath) {
    console.error("Erro: Forneça o caminho para o arquivo de configuração como argumento.");
    console.log("Uso: node script.js <caminho_para_config.json>");
    process.exit(1); // Encerra o processo com um código de erro
}

// Carrega a configuração e inicia a execução da função principal
const config = loadConfig(configFilePath);
fetchAllBusinessPartners(config);
